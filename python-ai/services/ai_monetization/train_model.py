import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score
import xgboost as xgb
import joblib
import os
from datetime import datetime
import logging

from core.feature_builder import FeatureBuilder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_sample_data(n_samples=10000):
    """ساخت دیتاست نمونه برای تست"""
    np.random.seed(42)
    
    data = []
    for _ in range(n_samples):
        # ویژگی‌ها
        engagement = np.random.beta(5, 5)
        days = np.random.exponential(30)
        dismiss = np.random.beta(2, 10)
        last_purchase = np.random.exponential(60)
        swipe = np.random.exponential(5)
        session_time = np.random.exponential(300)
        ctr = np.random.beta(2, 20)
        conversion_score = np.random.beta(3, 10)
        
        variant = np.random.choice(['vip', 'boost', 'credit', 'profile'])
        
        # feature vector
        features = {
            "engagement_score": engagement,
            "days_since_signup": days,
            "dismiss_rate": dismiss,
            "last_purchase_days": last_purchase,
            "swipe_velocity": swipe,
            "avg_session_time": session_time,
            "promotion_ctr": ctr,
            "conversion_score": conversion_score,
            "hour_of_day": np.random.randint(0, 24),
            "is_weekend": np.random.choice([0, 1]),
            "session_depth": np.random.randint(1, 30)
        }
        
        feature_vector = FeatureBuilder.build_features(features, variant)
        
        # label (آیا کاربر خرید میکنه؟)
        prob = (
            engagement * 0.3 +
            (1 - dismiss) * 0.2 +
            (1 - min(last_purchase / 100, 1)) * 0.2 +
            ctr * 0.3
        )
        label = 1 if np.random.random() < prob else 0
        
        data.append({
            "features": feature_vector,
            "variant": variant,
            "label": label
        })
    
    return data

def train():
    """آموزش مدل XGBoost"""
    logger.info("Generating sample data...")
    data = generate_sample_data(20000)
    
    X = np.array([d["features"] for d in data])
    y = np.array([d["label"] for d in data])
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    logger.info(f"Training XGBoost model...")
    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        use_label_encoder=False,
        eval_metric='logloss'
    )
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False
    )
    
    # ارزیابی
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
    
    logger.info(f"Accuracy: {accuracy:.4f}")
    logger.info(f"AUC: {auc:.4f}")
    
    # ذخیره مدل
    model_path = "models/promotion_model_v1.pkl"
    os.makedirs("models", exist_ok=True)
    joblib.dump(model, model_path)
    logger.info(f"Model saved to {model_path}")
    
    return model

if __name__ == "__main__":
    train()