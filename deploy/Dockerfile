# The deploy hook (see hook.mjs): Node to listen, the Docker CLI and compose plugin to act.
FROM node:24-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /hook
COPY hook.mjs ./
EXPOSE 9000
CMD ["node", "hook.mjs"]
