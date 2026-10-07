FROM python-ai-nlp:latest

WORKDIR /app
COPY . .

ENV PYTHONPATH=/app
ENV MODEL_PATH=/app/models
ENV TRANSFORMERS_OFFLINE=1

CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8016"]