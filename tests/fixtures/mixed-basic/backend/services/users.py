from ..repositories.users import UserRepository

class UserService:
    @staticmethod
    def create():
        return UserRepository.save()

    @staticmethod
    def get(user_id: int):
        return UserRepository.get(user_id)
