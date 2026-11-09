"""The deploy image only contains what .dockerignore whitelists.

A module that agent.py imports but the whitelist leaves out passes every other
test here and then crashes the agent on import in production, so no call is
answered. This checks the whole import closure of agent.py against the list.
"""

import ast
import pathlib
import unittest

HERE = pathlib.Path(__file__).parent


def local_imports(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    return {name for name in names if (HERE / f"{name}.py").exists()}


def import_closure(start: str) -> set[str]:
    seen: set[str] = set()
    todo = [start]
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        todo.extend(local_imports(HERE / f"{name}.py"))
    return seen


def whitelisted() -> set[str]:
    lines = (HERE / ".dockerignore").read_text(encoding="utf-8").splitlines()
    return {line[1:].strip() for line in lines if line.startswith("!")}


class ImagePackagingTests(unittest.TestCase):
    def test_every_module_the_agent_imports_is_in_the_image(self):
        needed = {f"{name}.py" for name in import_closure("agent")}
        missing = sorted(needed - whitelisted())
        self.assertEqual(missing, [], f"not in .dockerignore, so missing from the image: {missing}")

    def test_the_language_listener_is_in_the_image(self):
        self.assertIn("language_listener.py", whitelisted())
        self.assertIn("language_listener", import_closure("agent"))

    def test_the_whitelist_has_no_stale_entries(self):
        runtime = {"Dockerfile", "requirements.txt", "requirements-linux.lock"}
        stale = sorted(
            entry for entry in whitelisted() - runtime if not (HERE / entry).exists()
        )
        self.assertEqual(stale, [])


if __name__ == "__main__":
    unittest.main()
