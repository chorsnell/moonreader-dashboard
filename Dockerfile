FROM python:3.12-alpine

# no dependencies beyond the Python standard library
WORKDIR /app
COPY app/ /app/

ENV PORT=8080 \
    LIBRARY=/library \
    POLL_SECONDS=30 \
    KEEP_BACKUPS=5 \
    PUID=1000 \
    PGID=1000 \
    PYTHONUNBUFFERED=1

# starts as root only to hand /library to PUID:PGID, then drops to that user
VOLUME ["/library"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["python3", "/app/server.py"]
