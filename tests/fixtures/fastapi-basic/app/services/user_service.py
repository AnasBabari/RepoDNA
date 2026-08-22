from app.models.user import User

class UserService:
    def list_users(self) -> list[User]:
        return []

    def create_user(self, user: User) -> User:
        return user
