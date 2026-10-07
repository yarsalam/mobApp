class IntegrationManager:
    def __init__(self, redis_client):
        self.redis = redis_client

    def sync_feedback_with_recommendation(self, feedback_data):
        self.redis.publish("feedback_updates", feedback_data)

    def sync_notification_response(self, user_id, response_data):
        self.redis.hset(f"user:{user_id}:notification_response", mapping=response_data)
