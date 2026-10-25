# Java lab: code-server IDE on port 8080, runs as uid 1000 so bucket-mounted files are writable.
FROM codercom/code-server:4.96.4
USER root
# The base image is Debian 12, where the JDK is OpenJDK 17 (21 only exists on newer releases); try 21 first, fall back to 17.
RUN apt-get update \
    && (apt-get install -y --no-install-recommends openjdk-21-jdk || apt-get install -y --no-install-recommends openjdk-17-jdk) \
    && apt-get install -y --no-install-recommends maven git curl \
    && rm -rf /var/lib/apt/lists/*
COPY infra/images/common/settings.json /home/coder/.local/share/code-server/User/settings.json
RUN chown -R 1000:1000 /home/coder/.local
USER 1000
WORKDIR /workspace
EXPOSE 8080
# Auth is handled by the CloudLab API proxy; the port is only published on the worker's internal IP.
CMD ["code-server", "--auth", "none", "--bind-addr", "0.0.0.0:8080", "--disable-telemetry", "--disable-update-check", "--disable-getting-started-override", "/workspace"]
