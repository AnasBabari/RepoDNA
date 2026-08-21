from ..models.user import User

class UserRepository:
    @staticmethod
    def save():
        return User()

    @staticmethod
    def get(user_id: int):
        return User(id=user_id)
