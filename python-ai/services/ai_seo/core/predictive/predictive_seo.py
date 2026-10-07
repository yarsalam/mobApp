import logging
from datetime import datetime
from typing import Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

_MONTH_NAMES = {
    1: "فروردین",
    2: "اردیبهشت",
    3: "خرداد",
    4: "تیر",
    5: "مرداد",
    6: "شهریور",
    7: "مهر",
    8: "آبان",
    9: "آذر",
    10: "دی",
    11: "بهمن",
    12: "اسفند",
}


class PredictiveSEOEngine:
    def forecast_traffic(
        self, historical_data: List[Dict], days: int = 90
    ) -> Optional[Dict]:
        if len(historical_data) < 14:
            logger.warning("Not enough historical data for forecasting")
            return None

        from prophet import Prophet

        df = pd.DataFrame(historical_data)
        df["ds"] = pd.to_datetime(df["date"])
        df["y"] = pd.to_numeric(df["traffic"], errors="coerce").fillna(0)
        df = df[["ds", "y"]].sort_values("ds")

        model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True,
            daily_seasonality=False,
            seasonality_mode="multiplicative",
            changepoint_prior_scale=0.05,
        )
        model.fit(df)

        future = model.make_future_dataframe(periods=days)
        forecast = model.predict(future)

        last_actual = float(df["y"].iloc[-1])
        last_predicted = float(forecast["yhat"].iloc[-1])
        growth_rate = (
            (last_predicted - last_actual) / last_actual if last_actual else 0.0
        )

        forecast["month"] = forecast["ds"].dt.month
        monthly_avg = forecast.groupby("month")["yhat"].mean()
        peaks = [
            _MONTH_NAMES.get(m, str(m)) for m in monthly_avg.nlargest(3).index.tolist()
        ]

        return {
            "forecast": forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]]
            .tail(days)
            .assign(ds=lambda d: d["ds"].astype(str))
            .to_dict("records"),
            "growth_rate": round(growth_rate, 4),
            "peak_periods": peaks,
        }

    def alert_if_needed(self, current_traffic: float, forecast: Optional[Dict]) -> Dict:
        if not forecast or len(forecast.get("forecast", [])) < 30:
            return {"alert": False}
        next_month = forecast["forecast"][29].get("yhat", 0)
        if current_traffic == 0:
            return {"alert": False}
        decline = (current_traffic - next_month) / current_traffic
        if decline > 0.2:
            return {
                "alert": True,
                "message": f"پیش‌بینی کاهش {decline:.1%} ترافیک در ماه آینده",
                "action": "افزایش بودجه تبلیغات",
                "severity": "high",
                "decline_percent": round(decline, 4),
            }
        if decline > 0.1:
            return {
                "alert": True,
                "message": f"پیش‌بینی کاهش {decline:.1%} ترافیک",
                "action": "بررسی کمپین‌های جاری",
                "severity": "medium",
                "decline_percent": round(decline, 4),
            }
        return {"alert": False}

    def forecast_seasonal_trends(
        self, historical_data: List[Dict], years: int = 1
    ) -> Optional[Dict]:
        if len(historical_data) < 30:
            return None

        from prophet import Prophet

        df = pd.DataFrame(historical_data)
        df["ds"] = pd.to_datetime(df["date"])
        df["y"] = pd.to_numeric(df["traffic"], errors="coerce").fillna(0)
        df = df[["ds", "y"]].sort_values("ds")

        model = Prophet(yearly_seasonality=True, weekly_seasonality=False)
        model.fit(df)

        future = model.make_future_dataframe(periods=365 * years)
        forecast = model.predict(future)

        seasonal = forecast[["ds", "yearly"]].tail(365 * years).copy()
        seasonal["month"] = seasonal["ds"].dt.month
        monthly_factors = seasonal.groupby("month")["yearly"].mean().to_dict()

        return {
            "monthly_factors": monthly_factors,
            "peak_months": sorted(
                monthly_factors, key=monthly_factors.get, reverse=True
            )[:3],
            "low_months": sorted(monthly_factors, key=monthly_factors.get)[:3],
        }

    def predict_campaign_uplift(
        self, historical_data: List[Dict], campaign_budget: float, channel: str
    ) -> Optional[Dict]:
        uplift_rates = {"instagram": 0.05 / 1_000_000, "telegram": 0.08 / 1_000_000}
        uplift_factor = uplift_rates.get(channel, 0.0) * campaign_budget

        forecast = self.forecast_traffic(historical_data)
        if forecast is None:
            return None

        uplifted = [
            {**row, "yhat": row["yhat"] * (1 + uplift_factor)}
            for row in forecast["forecast"]
        ]
        return {**forecast, "forecast": uplifted, "uplift_factor": uplift_factor}
