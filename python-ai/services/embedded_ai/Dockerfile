FROM python-ai-nlp:latest

WORKDIR /app
COPY . .

ENV PYTHONPATH=/app
ENV REDIS_HOST=redis
ENV REDIS_PORT=6379

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]