FROM python-ai-ml-prophet:latest

WORKDIR /app
COPY . .
ENV PYTHONPATH=/app

CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8021"]