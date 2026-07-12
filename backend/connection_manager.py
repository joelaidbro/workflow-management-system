from fastapi import WebSocket
from typing import Dict


class ConnectionManager:
    def __init__(self):
        # Key: user_id (string), Value: WebSocket connection
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    async def register(self, user_id: str, websocket: WebSocket):
        old = self.active_connections.get(user_id)
        if old is not None and old is not websocket:
            try:
                await old.close(code=1001)
            except Exception:
                pass
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

    async def send_to_user(self, user_id: str, data: dict):
        """Send a message to a specific user if they are connected."""
        if user_id in self.active_connections:
            websocket = self.active_connections[user_id]
            try:
                await websocket.send_json(data)
            except Exception:
                # Connection dropped — clean it up
                self.disconnect(user_id)

    def is_online(self, user_id: str) -> bool:
        return user_id in self.active_connections


# Single global instance — imported by chat routes
manager = ConnectionManager()
