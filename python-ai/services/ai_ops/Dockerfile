FROM python-ai-ml-lite:latest

WORKDIR /app

RUN --mount=type=bind,from=wheels,source=.,target=/wheels \
    --mount=type=cache,target=/root/.cache/pip \
    pip install --find-links=/wheels boto3 requests

COPY . .
ENV PYTHONPATH=/app

CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8025"]