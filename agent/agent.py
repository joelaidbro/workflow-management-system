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
HEARTBEAT_INTERVAL_SECONDS = 60

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.ERROR,
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

    print(f"idle_seconds={idle_seconds}, returning={status}")
    return status


def send_heartbeat():
    try:
        status = get_current_status()
        print(f"Sending heartbeat with status: {status}")
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


def main():
    while True:
        try:
            send_heartbeat()
        except Exception as exc:
            logging.exception("Agent loop failed: %s", exc)

        time.sleep(HEARTBEAT_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        load_config()
        start_idle_detector()
        main()
    except Exception as exc:
        logging.exception("Agent startup failed: %s", exc)
        while True:
            time.sleep(HEARTBEAT_INTERVAL_SECONDS)
