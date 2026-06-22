import ctypes
import json
import logging
import time
from datetime import datetime
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
screenshot_enabled = True
screenshot_interval_seconds = 600
last_activity_at = time.time()


def load_config():
    global server_url, machine_token, staff_id
    global screenshot_enabled, screenshot_interval_seconds

    with CONFIG_PATH.open("r", encoding="utf-8") as config_file:
        config = json.load(config_file)

    server_url = config["server_url"].rstrip("/")
    machine_token = config["machine_token"]
    staff_id = config["staff_id"]
    screenshot_enabled = config.get("screenshot_enabled", True)
    screenshot_interval_seconds = config.get("screenshot_interval_seconds", 600)


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


def capture_and_upload_screenshot():
    try:
        import io

        import pyautogui
        from PIL import Image

        screenshot = pyautogui.screenshot()

        max_width = 1280
        max_height = 720
        screenshot.thumbnail((max_width, max_height), Image.LANCZOS)

        img_buffer = io.BytesIO()
        screenshot.save(img_buffer, format="JPEG", quality=60, optimize=True)
        img_buffer.seek(0)

        width, height = screenshot.size
        logging.info("Captured screenshot dimensions: %sx%s", width, height)

        captured_at = datetime.utcnow().isoformat() + "Z"
        response = requests.post(
            f"{server_url}/api/screenshots/upload",
            data={
                "machine_token": machine_token,
                "staff_id": staff_id,
                "captured_at": captured_at,
            },
            files={"file": ("screenshot.jpg", img_buffer, "image/jpeg")},
            timeout=30,
        )

        if response.status_code == 200:
            logging.info("Screenshot uploaded successfully")
        else:
            logging.warning("Screenshot upload failed: %s", response.status_code)

    except Exception as exc:
        logging.exception("Screenshot capture/upload failed: %s", exc)


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


def show_alert_popup(alert: dict) -> None:
    try:
        alert_type = alert.get("alert_type", "info")
        sender = alert.get("sender_name", "Admin")
        message = alert.get("message", "")

        title = "🔴 URGENT ALERT" if alert_type == "urgent" else "ℹ️ Info"
        body = f"From: {sender}\n\n{message}"

        # Use MB_SYSTEMMODAL flag (0x00001000) to force window above all others
        # Combined with MB_OK (0x00000000) and MB_SETFOREGROUND (0x00010000)
        MB_OK = 0x00000000
        MB_SYSTEMMODAL = 0x00001000
        MB_SETFOREGROUND = 0x00010000
        MB_ICONWARNING = 0x00000030
        MB_ICONINFORMATION = 0x00000040

        icon = MB_ICONWARNING if alert_type == "urgent" else MB_ICONINFORMATION
        flags = MB_OK | MB_SYSTEMMODAL | MB_SETFOREGROUND | icon

        ctypes.windll.user32.MessageBoxW(0, body, title, flags)

    except Exception as exc:
        logging.exception("Failed to show alert popup: %s", exc)

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
    last_screenshot = 0

    while True:
        try:
            now = time.time()

            check_alerts()

            if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                send_heartbeat()
                last_heartbeat = now

            if (
                screenshot_enabled
                and now - last_screenshot >= screenshot_interval_seconds
            ):
                current_status = get_current_status()
                if current_status == "active":
                    capture_and_upload_screenshot()
                last_screenshot = now
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
