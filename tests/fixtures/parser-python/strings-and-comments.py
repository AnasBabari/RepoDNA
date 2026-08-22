x = "def fake():"
route = '@app.get("/fake")'
template = """
class NotReal:
    def also_fake():
        pass
"""
commented = "# @app.get('/also-fake')"

# def fake_comment():
#     pass

import os


def real_function():
    label = "create_user()"
    return os.path.join("a", "b")
