import yaml
from pathlib import Path

CONFIG_DIR = Path(__file__).parent


def load_config(file: str = "base.yaml") -> dict:
    path = CONFIG_DIR / file
    if not path.exists():
        raise FileNotFoundError(f"[Config] Not found: {path.resolve()}")
    with open(path, "r") as f:
        return yaml.safe_load(f)


def load_experiment_config(name: str) -> dict:
    return load_config(Path("expr") / f"{name}.yaml")