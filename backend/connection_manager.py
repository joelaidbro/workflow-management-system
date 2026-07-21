import asyncio
import json
import logging
from typing import Dict

import redis.asyncio as aioredis
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self._redis: aioredis.Redis | None = None
        self._pubsub = None
        self._listener_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    async def startup(self, redis_url: str = "redis://localhost:6379"):
        self._loop = asyncio.get_running_loop()
        self._redis = aioredis.from_url(redis_url, decode_responses=False)
        self._pubsub = self._redis.pubsub()
        self._listener_task = asyncio.create_task(self._listen())

    async def shutdown(self):
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        if self._pubsub:
            await self._pubsub.close()
        if self._redis:
            await self._redis.aclose()

    async def _listen(self):
        """Background task: listens on Redis pub/sub and forwards to local WebSockets."""
        while True:
            # redis-py's listen() returns immediately (empty generator) when nothing
            # is subscribed, which would spin the event loop at 100% CPU. Wait until
            # at least one channel is registered before entering the generator.
            if not self._pubsub.subscribed:
                await asyncio.sleep(1)
                continue
            try:
                async for message in self._pubsub.listen():
                    if message["type"] != "message":
                        continue
                    try:
                        channel = message["channel"]
                        if isinstance(channel, bytes):
                            channel = channel.decode()
                        user_id = channel.split(":")[-1]
                        data = json.loads(message["data"])
                        ws = self.active_connections.get(user_id)
                        if ws:
                            try:
                                await ws.send_json(data)
                            except Exception:
                                self.active_connections.pop(user_id, None)
                    except Exception as e:
                        logger.debug(f"WS forward error: {e}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"Redis pubsub error: {e}. Reconnecting in 2s...")
                await asyncio.sleep(2)

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    async def register(self, user_id: str, websocket: WebSocket):
        """Register a WebSocket after auth. Closes any existing connection for this user."""
        old = self.active_connections.get(user_id)
        if old is not None and old is not websocket:
            try:
                await old.close(code=1001)
            except Exception:
                pass
        self.active_connections[user_id] = websocket
        if self._redis:
            try:
                await self._redis.set(f"wf:online:{user_id}", "1", ex=600)
            except Exception as e:
                logger.warning(f"Redis set failed for {user_id}: {e}")
        if self._pubsub:
            try:
                await self._pubsub.subscribe(f"wf:notify:{user_id}")
            except Exception as e:
                logger.warning(f"Redis subscribe failed for {user_id}: {e}")

    def disconnect(self, user_id: str):
        self.active_connections.pop(user_id, None)
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._cleanup_redis(user_id), self._loop)

    async def _cleanup_redis(self, user_id: str):
        if self._redis:
            try:
                await self._redis.delete(f"wf:online:{user_id}", f"wf:visible:{user_id}")
            except Exception as e:
                logger.warning(f"Redis delete failed for {user_id}: {e}")
        if self._pubsub:
            try:
                await self._pubsub.unsubscribe(f"wf:notify:{user_id}")
            except Exception:
                pass

    async def send_to_user(self, user_id: str, data: dict):
        """Send to a user — tries direct first, falls back to Redis publish for cross-worker."""
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
                return
            except Exception:
                self.active_connections.pop(user_id, None)
        if self._redis:
            try:
                await self._redis.publish(f"wf:notify:{user_id}", json.dumps(data))
            except Exception as e:
                logger.debug(f"Redis publish failed for {user_id}: {e}")

    async def notify_user(self, user_id: str, data: dict):
        """Publish a notification event via Redis (always cross-worker safe)."""
        if self._redis:
            try:
                await self._redis.publish(f"wf:notify:{user_id}", json.dumps(data))
            except Exception as e:
                logger.debug(f"Redis notify failed for {user_id}: {e}")

    def notify_user_sync(self, user_id: str, data: dict):
        """Schedule a notification from a sync endpoint running in a threadpool."""
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.notify_user(user_id, data), self._loop)

    async def is_connected(self, user_id: str) -> bool:
        """Cross-worker aware connection check via Redis."""
        if self._redis:
            try:
                return bool(await self._redis.exists(f"wf:online:{user_id}"))
            except Exception:
                pass
        return user_id in self.active_connections

    async def set_visible(self, user_id: str, visible: bool):
        """Records whether the user's tab is currently foregrounded (Page Visibility API).
        Backed by a short-TTL Redis key so a backgrounded/closed tab naturally expires
        even if the WebSocket itself stays open (reconnect logic keeps sockets alive
        long after the user has stopped looking at the screen)."""
        if not self._redis:
            return
        key = f"wf:visible:{user_id}"
        try:
            if visible:
                await self._redis.set(key, "1", ex=45)
            else:
                await self._redis.delete(key)
        except Exception as e:
            logger.debug(f"Redis visibility update failed for {user_id}: {e}")

    async def is_visible(self, user_id: str) -> bool:
        """True only if the user's tab is open AND currently foregrounded/visible."""
        if self._redis:
            try:
                return bool(await self._redis.exists(f"wf:visible:{user_id}"))
            except Exception:
                pass
        return False

    def is_online(self, user_id: str) -> bool:
        """Same-worker connection check (kept for backward compatibility)."""
        return user_id in self.active_connections


# Single global instance — imported by all routers
manager = ConnectionManager()
