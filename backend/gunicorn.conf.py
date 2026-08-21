bind = "0.0.0.0:8001"
workers = 2
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
keepalive = 5
max_requests = 1000
max_requests_jitter = 100
accesslog = "/var/log/workflowapp/access.log"
errorlog = "/var/log/workflowapp/error.log"
loglevel = "info"

# TLS is terminated by OpenLiteSpeed, which proxies to this process over
# plain HTTP on localhost (see /api/ context in the OpenLiteSpeed vhost
# config). Gunicorn must NOT also terminate TLS here — if keyfile/certfile
# are set, gunicorn only accepts HTTPS connections, but OpenLiteSpeed's
# proxy speaks plain HTTP to it, so every request hangs until timeout and
# OpenLiteSpeed serves its own 503 page instead of ever reaching the app.
# (This bit the Google Calendar OAuth callback and, later, login itself —
# do not re-add these two lines.)
# keyfile = "/etc/letsencrypt/live/teams.aidbro.com/privkey.pem"
# certfile = "/etc/letsencrypt/live/teams.aidbro.com/fullchain.pem"