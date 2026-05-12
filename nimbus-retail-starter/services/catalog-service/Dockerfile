FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3002/healthz').read()" || exit 1
CMD ["python", "src/main.py"]
