import os, json
import numpy as np

MODEL_DIR = os.getenv("ML_MODEL_DIR", "/tmp/ml_models")

def load_model(name="behavior_xgb"):
    path = os.path.join(MODEL_DIR, f"{name}.xgb")
    if os.path.exists(path):
        try:
            import xgboost as xgb
            m = xgb.Booster()
            m.load_model(path)
            return m
        except Exception:
            return None
    return None

def predict_response_probability(model, features: dict):
    if model is None:
        return None
    # construct dmatrix from features dict (ensure order)
    import xgboost as xgb
    import pandas as pd
    df = pd.DataFrame([features])
    d = xgb.DMatrix(df)
    return float(model.predict(d)[0])
