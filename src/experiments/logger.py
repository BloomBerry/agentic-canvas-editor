import logging
import json
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, Optional


class ExperimentLogger:
    def __init__(self, experiment_id: str, log_dir: Optional[Path] = None):
        self.experiment_id = experiment_id
        self.logger = logging.getLogger(f"experiment.{experiment_id}")
        self.setup_logger(log_dir or Path("results") / experiment_id)

    def setup_logger(self, log_dir: Path):
        log_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
        log_file = log_dir / f"experiment_log_{timestamp}.txt"

        formatter = logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )

        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)

        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)

        self.logger.addHandler(file_handler)
        self.logger.addHandler(console_handler)
        self.logger.setLevel(logging.INFO)

        self.logger.info(f"Experiment started: {self.experiment_id}")
        self.logger.info(f"Log file: {log_file}")

    def info(self, message: str, **kwargs):
        if kwargs:
            self.logger.info(f"{message} {json.dumps(kwargs, ensure_ascii=False)}")
        else:
            self.logger.info(message)

    def error(self, message: str, error: Optional[Exception] = None, **kwargs):
        if error:
            self.logger.error(f"{message}: {str(error)}", exc_info=True)
        elif kwargs:
            self.logger.error(f"{message} {json.dumps(kwargs, ensure_ascii=False)}")
        else:
            self.logger.error(message)

    def warning(self, message: str, **kwargs):
        if kwargs:
            self.logger.warning(f"{message} {json.dumps(kwargs, ensure_ascii=False)}")
        else:
            self.logger.warning(message)

    def debug(self, message: str, **kwargs):
        if kwargs:
            self.logger.debug(f"{message} {json.dumps(kwargs, ensure_ascii=False)}")
        else:
            self.logger.debug(message)

    def log_metric(self, name: str, value: float, step: Optional[int] = None):
        metric_data = {"name": name, "value": value}
        if step is not None:
            metric_data["step"] = step
        self.info(f"Metric: {json.dumps(metric_data, ensure_ascii=False)}")

    def add_case_log(self, case_dir: Path):
        """Add an additional file handler that writes into a per-case result directory."""
        case_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
        log_file = case_dir / f"experiment_log_{timestamp}.txt"

        formatter = logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )
        handler = logging.FileHandler(log_file, encoding="utf-8")
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)
        self._case_handler = handler
        return log_file

    def remove_case_log(self):
        """Remove the per-case file handler added by add_case_log."""
        handler = getattr(self, "_case_handler", None)
        if handler:
            self.logger.removeHandler(handler)
            handler.close()
            self._case_handler = None

    def log_config(self, config: Dict[str, Any]):
        self.info("Configuration", config=config)
