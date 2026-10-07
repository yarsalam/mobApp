import asyncio
import redis.asyncio as aioredis
import json
from models.xgb_model import XGBMatchModel

async def process_training_job():
    redis = aioredis.from_url("redis://redis:6379/0")
    # اینجا باید از Redis Queue استفاده کنیم که BullMQ پشت آن است
    # BullMQ از ساختار پیچیده‌ای استفاده می‌کند، برای سادگی می‌توانیم از یک لیست ساده Redis استفاده کنیم
    # بهتر است از کتابخانه‌ای مانند `bull` برای Python استفاده کنیم یا صف را در NestJS نگه داریم و فقط نتیجه را از طریق API ارسال کنیم.
    # اما فعلاً یک راه ساده: ما یک endpoint در ml_service داریم که NestJS پس از اتمام job فراخوانی کند.ظظ