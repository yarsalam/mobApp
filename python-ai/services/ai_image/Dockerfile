FROM python-ai-tf-pillow:latest

WORKDIR /app

# wheels از additional_contexts
COPY --from=wheels / /tmp/wheels

RUN pip install --no-index --find-links=/tmp/wheels nudenet

COPY . .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]