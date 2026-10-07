FROM python-ai-core

USER root

RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libxcb1 \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=bind,source=downloaded_wheels,target=/wheels,readonly \
    --mount=type=cache,target=/root/.cache/pip \
    pip install --no-index --find-links=/wheels \
        tensorflow \
        h5py \
        opencv-python-headless 

USER appuser

CMD ["bash"]
