from services.users import UserService


def outer():
    def inner():
        return helper()

    value = inner()
    return value


class Handler:
    def create(self):
        service = UserService()
        return service.save()

    async def fetch(self, client):
        return await client.get("/upstream")
