FROM python-ai-tf-panda:latest

WORKDIR /app
COPY . .
ENV PYTHONPATH=/app

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]