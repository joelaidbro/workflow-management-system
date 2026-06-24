import ctypes
import io
import json
import logging
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk
from datetime import datetime
from pathlib import Path

import pyautogui
import pystray
import requests
from PIL import Image, ImageDraw
from pynput import keyboard, mouse

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
LOG_PATH = BASE_DIR / "agent.log"

IDLE_THRESHOLD_SECONDS = 600
HEARTBEAT_INTERVAL = 60
ALERT_INTERVAL = 15
SESSION_POLL_INTERVAL = 15
TRAY_UPDATE_INTERVAL = 5

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

config = {}
last_activity_at = time.time()

state_lock = threading.Lock()
agent_state = "standby"
server_connected = False
session_active = False
staff_name = ""
status_value_label = None
server_value_label = None
staff_value_label = None
main_window = None


def load_config() -> None:
    global config

    with CONFIG_PATH.open("r", encoding="utf-8") as config_file:
        loaded_config = json.load(config_file)

    required_keys = ("server_url", "machine_token", "staff_id")
    missing_keys = [key for key in required_keys if not loaded_config.get(key)]
    if missing_keys:
        raise ValueError(f"Missing required config keys: {', '.join(missing_keys)}")

    loaded_config["server_url"] = loaded_config["server_url"].rstrip("/")
    loaded_config["screenshot_enabled"] = loaded_config.get(
        "screenshot_enabled",
        True,
    )
    loaded_config["screenshot_interval_seconds"] = loaded_config.get(
        "screenshot_interval_seconds",
        600,
    )
    config = loaded_config


def set_state(
    *,
    new_agent_state=None,
    connected=None,
    active_session=None,
    name=None,
) -> None:
    global agent_state, server_connected, session_active, staff_name

    with state_lock:
        if new_agent_state is not None:
            agent_state = new_agent_state
        if connected is not None:
            server_connected = connected
        if active_session is not None:
            session_active = active_session
        if name is not None:
            staff_name = name


def get_state_snapshot() -> dict:
    with state_lock:
        return {
            "agent_state": agent_state,
            "server_connected": server_connected,
            "session_active": session_active,
            "staff_name": staff_name,
        }


def record_activity(*args) -> None:
    global last_activity_at
    last_activity_at = time.time()


def start_idle_detector() -> None:
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
    if get_idle_seconds() > IDLE_THRESHOLD_SECONDS:
        return "idle"
    return "active"


def verify_agent_startup() -> tuple[bool, str]:
    try:
        response = requests.post(
            f"{config['server_url']}/api/agent/verify",
            json={
                "staff_id": config["staff_id"],
                "machine_token": config["machine_token"],
            },
            timeout=10,
        )
        if response.status_code != 200:
            logging.warning("Agent verify failed: %s", response.text)
            set_state(connected=False)
            return False, ""

        data = response.json()
        name = data.get("full_name", "")
        set_state(connected=True, name=name)
        return True, name
    except Exception as exc:
        logging.exception("Agent verify failed: %s", exc)
        set_state(connected=False)
        return False, ""


def get_status_display_text() -> str:
    return f"● {get_status_label()}"


def get_status_color() -> str:
    snapshot = get_state_snapshot()
    return {
        "working": "green",
        "standby": "gray",
        "break": "orange",
        "meeting": "blue",
        "idle": "#b58900",
    }.get(snapshot["agent_state"], "gray")


def exit_from_status_window() -> None:
    if get_state_snapshot()["agent_state"] != "standby":
        messagebox.showinfo(
            "WorkFlow Agent",
            "Cannot exit while working. Please End My Day first.",
        )
        return

    if messagebox.askyesno("WorkFlow Agent", "Exit WorkFlow Agent?"):
        sys.exit(0)


def create_status_window():
    global main_window, status_value_label, server_value_label, staff_value_label

    window = tk.Tk()
    main_window = window
    window.title("WorkFlow Agent")
    window.geometry("380x220")
    window.resizable(False, False)

    def on_close():
        window.iconify()

    window.protocol("WM_DELETE_WINDOW", on_close)
    window.attributes("-topmost", False)

    screen_width = window.winfo_screenwidth()
    screen_height = window.winfo_screenheight()
    x = int((screen_width - 380) / 2)
    y = int((screen_height - 220) / 2)
    window.geometry(f"380x220+{x}+{y}")

    container = ttk.Frame(window, padding=14)
    container.pack(fill="both", expand=True)

    title_label = tk.Label(
        container,
        text="🖥️ WorkFlow Agent",
        font=("Segoe UI", 16, "bold"),
    )
    title_label.pack(anchor="w")

    ttk.Separator(container, orient="horizontal").pack(fill="x", pady=(8, 10))

    status_row = ttk.Frame(container)
    status_row.pack(fill="x", pady=2)
    ttk.Label(status_row, text="Status:", width=10).pack(side="left")
    status_value_label = tk.Label(
        status_row,
        text=get_status_display_text(),
        fg=get_status_color(),
        font=("Segoe UI", 10, "bold"),
    )
    status_value_label.pack(side="left")

    server_row = ttk.Frame(container)
    server_row.pack(fill="x", pady=2)
    ttk.Label(server_row, text="Server:", width=10).pack(side="left")
    server_value_label = tk.Label(server_row, text="", font=("Segoe UI", 10, "bold"))
    server_value_label.pack(side="left")

    staff_row = ttk.Frame(container)
    staff_row.pack(fill="x", pady=2)
    ttk.Label(staff_row, text="Staff:", width=10).pack(side="left")
    staff_value_label = tk.Label(
        staff_row,
        text=get_state_snapshot()["staff_name"] or "Not connected",
        font=("Segoe UI", 10),
    )
    staff_value_label.pack(side="left")

    ttk.Separator(container, orient="horizontal").pack(fill="x", pady=(10, 8))

    note_label = tk.Label(
        container,
        text="This window monitors your work activity. Minimize it if needed.",
        fg="gray",
        font=("Segoe UI", 8),
    )
    note_label.pack(anchor="w")

    exit_button = ttk.Button(container, text="Exit", command=exit_from_status_window)
    exit_button.pack(anchor="e", pady=(8, 0))

    return window


def update_status_labels() -> None:
    if not main_window:
        return

    snapshot = get_state_snapshot()
    if status_value_label:
        status_value_label.config(
            text=get_status_display_text(),
            fg=get_status_color(),
        )
    if server_value_label:
        server_value_label.config(
            text="● Connected" if snapshot["server_connected"] else "● Disconnected",
            fg="green" if snapshot["server_connected"] else "red",
        )
    if staff_value_label:
        staff_value_label.config(text=snapshot["staff_name"] or "Not connected")

    main_window.after(5000, update_status_labels)


def normalize_server_status(status: str | None, active_session: bool) -> str:
    if not active_session:
        return "standby"
    if status in {"break", "meeting", "idle"}:
        return status
    return "working"


def poll_session_status() -> None:
    try:
        response = requests.get(
            f"{config['server_url']}/api/agent/session-status",
            params={
                "machine_token": config["machine_token"],
                "staff_id": config["staff_id"],
            },
            timeout=10,
            verify=True,
        )
        if response.status_code != 200:
            logging.warning("Session status failed: %s", response.text)
            set_state(connected=False)
            return

        data = response.json()
        active_session = bool(data.get("session_active"))
        server_status = data.get("current_status", "offline")
        snapshot = get_state_snapshot()

        next_state = None
        if not active_session:
            next_state = "standby"
        elif server_status in ("break", "meeting"):
            next_state = server_status
        elif snapshot["agent_state"] in ("break", "meeting") and server_status == "active":
            next_state = "working"
        elif snapshot["agent_state"] == "standby" and active_session:
            next_state = "working"

        set_state(
            new_agent_state=next_state,
            connected=True,
            active_session=active_session,
        )
    except Exception as exc:
        logging.exception("Session status polling failed: %s", exc)
        set_state(connected=False)


def send_heartbeat() -> None:
    try:
        current_agent_state = get_state_snapshot()["agent_state"]
        if current_agent_state == "standby":
            return

        if current_agent_state in ("break", "meeting"):
            heartbeat_status = current_agent_state
        else:
            heartbeat_status = get_current_status()

        response = requests.post(
            f"{config['server_url']}/api/agent/heartbeat",
            json={
                "staff_id": config["staff_id"],
                "machine_token": config["machine_token"],
                "status": heartbeat_status,
            },
            timeout=10,
            verify=True,
        )
        if response.status_code == 200:
            set_state(connected=True)
        else:
            logging.warning("Heartbeat failed: %s", response.text)
            set_state(connected=False)
    except Exception as exc:
        logging.exception("Heartbeat failed: %s", exc)
        set_state(connected=False)


def check_alerts() -> None:
    try:
        response = requests.get(
            f"{config['server_url']}/api/alerts/pending",
            params={
                "staff_id": config["staff_id"],
                "machine_token": config["machine_token"],
            },
            timeout=10,
        )
        if response.status_code != 200:
            logging.warning("Alert polling failed: %s", response.text)
            return

        for alert in response.json():
            show_alert_popup(alert)
            acknowledge_alert(alert["alert_recipient_id"])
    except Exception as exc:
        logging.exception("Alert polling failed: %s", exc)


def show_alert_popup(alert: dict) -> None:
    try:
        alert_type = alert.get("alert_type", "info")
        sender = alert.get("sender_name", "Admin")
        message = alert.get("message", "")

        title = (
            "⚠️ URGENT — WorkFlow Alert"
            if alert_type == "urgent"
            else "ℹ️ Info — WorkFlow Alert"
        )
        separator = "─────────────────────────────"
        body = (
            f"From: {sender}\n"
            f"{separator}\n\n"
            f"{message}\n\n"
            f"{separator}\n"
            "Click OK to acknowledge"
        )

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


def acknowledge_alert(alert_recipient_id: str) -> None:
    try:
        response = requests.post(
            f"{config['server_url']}/api/alerts/acknowledge",
            params={
                "staff_id": config["staff_id"],
                "machine_token": config["machine_token"],
            },
            json={
                "alert_recipient_id": alert_recipient_id,
                "reply": None,
            },
            timeout=10,
        )
        if response.status_code != 200:
            logging.warning("Alert acknowledgement failed: %s", response.text)
    except Exception as exc:
        logging.exception("Alert acknowledgement failed: %s", exc)


def capture_and_upload_screenshot() -> None:
    try:
        snapshot = get_state_snapshot()
        if snapshot["agent_state"] != "working" or get_current_status() != "active":
            return

        screenshot = pyautogui.screenshot()
        screenshot.thumbnail((1280, 720), Image.LANCZOS)

        img_buffer = io.BytesIO()
        screenshot.save(img_buffer, format="JPEG", quality=60, optimize=True)
        img_buffer.seek(0)

        captured_at = datetime.utcnow().isoformat() + "Z"
        response = requests.post(
            f"{config['server_url']}/api/screenshots/upload",
            data={
                "machine_token": config["machine_token"],
                "staff_id": config["staff_id"],
                "captured_at": captured_at,
            },
            files={"file": ("screenshot.jpg", img_buffer, "image/jpeg")},
            timeout=30,
        )

        if response.status_code == 200:
            logging.info("Screenshot uploaded successfully")
        else:
            logging.warning("Screenshot upload failed: %s", response.text)
    except Exception as exc:
        logging.exception("Screenshot capture/upload failed: %s", exc)


def create_tray_icon_image() -> Image.Image:
    snapshot = get_state_snapshot()
    if not snapshot["server_connected"]:
        color = "#dc2626"
    else:
        color = {
            "working": "#16a34a",
            "standby": "#6b7280",
            "break": "#f97316",
            "meeting": "#2563eb",
            "idle": "#eab308",
        }.get(snapshot["agent_state"], "#6b7280")

    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((8, 8, 56, 56), fill=color)
    draw.ellipse((8, 8, 56, 56), outline="#111827", width=3)
    return image


def get_status_label() -> str:
    snapshot = get_state_snapshot()
    return {
        "working": "Working",
        "standby": "Standby",
        "break": "On Break",
        "meeting": "In Meeting",
        "idle": "Idle",
    }.get(snapshot["agent_state"], "Standby")


def get_server_label() -> str:
    if get_state_snapshot()["server_connected"]:
        return "Connected"
    return "Disconnected"


def show_exit_blocked_message() -> None:
    ctypes.windll.user32.MessageBoxW(
        0,
        "Cannot exit while working. Please End My Day first.",
        "WorkFlow Agent",
        0x00001000 | 0x00010000 | 0x00000040,
    )


def exit_agent(icon, item) -> None:
    if get_state_snapshot()["agent_state"] != "standby":
        show_exit_blocked_message()
        return

    icon.stop()
    sys.exit(0)


def create_tray_menu() -> pystray.Menu:
    return pystray.Menu(
        pystray.MenuItem("WorkFlow Agent", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(lambda item: f"Status: {get_status_label()}", None, enabled=False),
        pystray.MenuItem(lambda item: f"Server: {get_server_label()}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(
            "Exit",
            exit_agent,
            enabled=lambda item: get_state_snapshot()["agent_state"] == "standby",
        ),
    )


def tray_update_loop(icon: pystray.Icon) -> None:
    while True:
        try:
            icon.icon = create_tray_icon_image()
            icon.menu = create_tray_menu()
            icon.update_menu()
        except Exception as exc:
            logging.exception("Tray update failed: %s", exc)
        time.sleep(TRAY_UPDATE_INTERVAL)


def start_tray_icon() -> None:
    icon = pystray.Icon(
        "workflow_agent",
        create_tray_icon_image(),
        "WorkFlow Agent",
        create_tray_menu(),
    )
    threading.Thread(target=tray_update_loop, args=(icon,), daemon=True).start()
    icon.run()


def main_loop() -> None:
    screenshot_interval = config.get("screenshot_interval_seconds", 600)
    last_heartbeat = 0
    last_screenshot = 0
    last_session_poll = 0

    while True:
        try:
            now = time.time()

            if now - last_session_poll >= SESSION_POLL_INTERVAL:
                poll_session_status()
                last_session_poll = now

            check_alerts()

            current_agent_state = get_state_snapshot()["agent_state"]

            if current_agent_state in ("working", "break", "meeting"):
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    send_heartbeat()
                    last_heartbeat = now

            screenshot_enabled = config.get("screenshot_enabled", True)
            if screenshot_enabled and now - last_screenshot >= screenshot_interval:
                if (
                    get_state_snapshot()["agent_state"] == "working"
                    and get_current_status() == "active"
                ):
                    capture_and_upload_screenshot()
                last_screenshot = now
        except Exception as exc:
            logging.exception("Main loop error: %s", exc)

        time.sleep(ALERT_INTERVAL)


if __name__ == "__main__":
    try:
        load_config()
        start_idle_detector()
        verify_agent_startup()
        threading.Thread(target=main_loop, daemon=True).start()
        threading.Thread(target=start_tray_icon, daemon=True).start()
        window = create_status_window()
        update_status_labels()
        window.mainloop()
    except Exception as exc:
        logging.exception("Agent startup failed: %s", exc)
        ctypes.windll.user32.MessageBoxW(
            0,
            "WorkFlow Agent failed to start. Please contact IT.",
            "WorkFlow Agent",
            0x00001000 | 0x00010000 | 0x00000010,
        )
