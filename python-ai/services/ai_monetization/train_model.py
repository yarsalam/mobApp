"""Legacy synthetic training is intentionally disabled.

Promotion models may only be trained by the service endpoint from verified
randomized-experiment outcomes. The previous sample generator assigned labels
independently of promotion variant and therefore taught no valid treatment
preference.
"""


def train():
    raise RuntimeError(
        "Synthetic promotion training is disabled. Collect attributed outcomes "
        "from a randomized promotion experiment and use POST "
        "/api/retrain-from-feedback."
    )


if __name__ == "__main__":
    train()
