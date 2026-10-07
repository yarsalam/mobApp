FROM python-ai-transformers:latest

WORKDIR /app
COPY . .

ENV PYTHONPATH=/app
ENV REDIS_URL=redis://redis:6379/0

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8022"]