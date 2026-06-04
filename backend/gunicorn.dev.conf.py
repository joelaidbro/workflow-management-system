bind = "127.0.0.1:8000"
workers = 2
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
keepalive = 5
max_requests = 1000
max_requests_jitter = 100
loglevel = "info"
