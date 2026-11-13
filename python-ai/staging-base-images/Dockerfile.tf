FROM python-ai-core:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev libxcb1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir tensorflow h5py opencv-python-headless
USER appuser
CMD ["bash"]
