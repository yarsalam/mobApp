FROM python-ai-ml-lite:latest

WORKDIR /app
COPY . .

ENV PYTHONPATH=/app
ENV MODEL_PATH=/app/models

RUN mkdir -p /app/models && chown -R appuser:appuser /app/models

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8015"]