def complicated(
    first: str,
    second: int = 3,
    *args,
    keyword: bool | None = None,
    **kwargs,
) -> dict[str, int]:
    return {}


class WideService(
    BaseMixin,
    object,
):
    def method_with_long_signature(
        self,
        alpha: str,
        beta: list[int],
        gamma: tuple[str, ...] | None = None,
    ) -> None:
        pass
