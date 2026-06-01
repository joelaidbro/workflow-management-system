import ctypes
import json
import logging
import time
from pathlib import Path

import requests
from pynput import keyboard, mouse

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
LOG_PATH = BASE_DIR / "agent.log"
IDLE_THRESHOLD_SECONDS = 600
HEARTBEAT_INTERVAL = 60
ALERT_INTERVAL = 15

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

server_url = ""
machine_token = ""
staff_id = ""
last_activity_at = time.time()


def load_config():
    global server_url, machine_token, staff_id

    with CONFIG_PATH.open("r", encoding="utf-8") as config_file:
        config = json.load(config_file)

    server_url = config["server_url"].rstrip("/")
    machine_token = config["machine_token"]
    staff_id = config["staff_id"]


def record_activity(*args):
    global last_activity_at
    last_activity_at = time.time()


def start_idle_detector():
    mouse_listener = mouse.Listener(
        on_move=record_activity,
        on_click=record_activity,
        on_scroll=record_activity,
    )
    keyboard_listener = keyboard.Listener(on_press=record_activity)

    mouse_listener.start()
    keyboard_listener.start()


def get_idle_seconds() -> int:
    return int(time.time() - last_activity_at)


def get_current_status() -> str:
    idle_seconds = get_idle_seconds()

    if idle_seconds > IDLE_THRESHOLD_SECONDS:
        status = "idle"
    else:
        status = "active"

    logging.info("idle_seconds=%s, returning=%s", idle_seconds, status)
    return status


def send_heartbeat():
    try:
        status = get_current_status()
        logging.info("Sending heartbeat with status: %s", status)
        requests.post(
            f"{server_url}/api/agent/heartbeat",
            json={
                "staff_id": staff_id,
                "machine_token": machine_token,
                "status": status,
            },
            timeout=10,
        )
    except Exception as exc:
        logging.exception("Heartbeat failed: %s", exc)


def check_alerts():
    try:
        response = requests.get(
            f"{server_url}/api/alerts/pending",
            params={
                "staff_id": staff_id,
                "machine_token": machine_token,
            },
            timeout=10,
        )
        if response.status_code != 200:
            logging.error("Alert polling failed: %s", response.text)
            return

        alerts = response.json()
        for alert in alerts:
            show_alert_popup(alert)
            acknowledge_alert(alert["alert_recipient_id"])
    except Exception as exc:
        logging.exception("Alert polling failed: %s", exc)


def show_alert_popup(alert: dict):
    if alert["alert_type"] == "urgent":
        title = "⚠️ Urgent"
    else:
        title = "ℹ️ Info"

    body = f"{alert['sender_name']}:\n\n{alert['message']}"
    ctypes.windll.user32.MessageBoxW(0, body, title, 0)


def acknowledge_alert(alert_recipient_id: str):
    try:
        requests.post(
            f"{server_url}/api/alerts/acknowledge",
            params={
                "staff_id": staff_id,
                "machine_token": machine_token,
            },
            json={
                "alert_recipient_id": alert_recipient_id,
                "reply": None,
            },
            timeout=10,
        )
    except Exception as exc:
        logging.exception("Alert acknowledgement failed: %s", exc)


def main():
    last_heartbeat = 0

    while True:
        try:
            now = time.time()

            check_alerts()

            if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                send_heartbeat()
                last_heartbeat = now
        except Exception as exc:
            logging.exception("Main loop error: %s", exc)

        time.sleep(ALERT_INTERVAL)


if __name__ == "__main__":
    try:
        load_config()
        start_idle_detector()
        main()
    except Exception as exc:
        logging.exception("Agent startup failed: %s", exc)
        while True:
            time.sleep(ALERT_INTERVAL)
