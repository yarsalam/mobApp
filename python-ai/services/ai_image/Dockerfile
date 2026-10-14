FROM python-ai-tf-pillow:latest

WORKDIR /app

# wheels از additional_contexts; mount avoids copying the wheelhouse into an image layer.
RUN --mount=type=bind,from=wheels,source=.,target=/wheels \
    pip install --no-index --find-links=/wheels nudenet

COPY . .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]