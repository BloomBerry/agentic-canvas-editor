"""
XML Ablation Experiment Runner

Extends FigmaSlideExperiment to replace SceneGraph context with OOXML
(PresentationML) XML, for ablation study comparing hierarchical SceneGraph
vs. flat XML with absolute positioning.
"""

import json
import asyncio
import argparse
import aiohttp
from pathlib import Path
from dotenv import load_dotenv

from .base_runner import ExperimentConfig, parse_common_args
from .run_figma_slide_mcp_experiment import FigmaSlideExperiment
from .xml_converter import scenegraph_to_xml, style_metadata_to_xml
from .care_router import RoutingDecision, RoutingMode

load_dotenv(Path(__file__).resolve().parents[2] / "config.env")


class FigmaSlideXmlExperiment(FigmaSlideExperiment):
    """XML ablation variant of the Figma Slide experiment.

    The context presented to the Design Agent is converted from
    SceneGraph JSON to OOXML PresentationML XML while keeping the
    same CARE routing and ACE tools.
    """

    def __init__(self, config: ExperimentConfig):
        super().__init__(config)
        self._current_id_mapping: dict = {}

    # ---- Override: convert SceneGraph context to XML ----

    def _prepare_context(
        self,
        decision: RoutingDecision,
        base_json_string: str,
        data_dir: Path,
        summary,
    ) -> str:
        """Build OOXML context from SceneGraph context.

        1. Call parent to produce the SceneGraph context (skeleton,
           micro-spatial, style metadata, or full).
        2. Convert the SceneGraph JSON to OOXML XML.
        3. Store the ID mapping for passing to the TS endpoint.
        """
        sg_context_str = super()._prepare_context(
            decision, base_json_string, data_dir, summary
        )

        try:
            sg_context = json.loads(sg_context_str)
        except json.JSONDecodeError:
            self.logger.warning(
                "[XML] Failed to parse SceneGraph context as JSON, using raw"
            )
            self._current_id_mapping = {}
            return sg_context_str

        # Style metadata (systemic_token) has no spatial tree —
        # use dedicated converter to produce equivalent XML
        if decision.mode == RoutingMode.SYSTEMIC_TOKEN:
            xml_string, id_mapping = style_metadata_to_xml(sg_context)
            self._current_id_mapping = id_mapping
        else:
            xml_string, id_mapping = scenegraph_to_xml(
                sg_context, decision.target_slide_indices
            )
            self._current_id_mapping = id_mapping

        self.logger.info(
            f"[XML] Converted SceneGraph to OOXML: "
            f"{len(sg_context_str):,} bytes JSON → {len(xml_string):,} bytes XML, "
            f"{len(self._current_id_mapping)} element mappings"
        )

        return xml_string

    # ---- Override: use XML endpoint and pass mapping ----

    async def run_modification(
        self,
        session,
        image_bytes,
        base_json_string,
        instruction,
        result_name,
        context_json_string=None,
        routing_mode=None,
        image_data=None,
        target_slide_indices=None,
    ):
        """Send modification request to /xml-modification endpoint.

        Same as parent but:
        - Uses /xml-modification endpoint instead of /modification
        - Adds xmlIdMapping form field with the ID mapping dict
        """
        endpoint = "xml-modification"

        base_meta = self.experiment_config["models"][self.config.model.value]
        agent_type = (
            self.config.agent_type.value
            if self.config.agent_type
            else self.experiment_config.get("agent_type", "single_figma_slide")
        )

        def build_metadata():
            metadata = {
                "case_id": result_name,
                "model_provider": base_meta["provider"],
                "model_name": base_meta["name"],
                "agent_type": agent_type,
                "temperature": base_meta.get("temperature", 0.0),
                "input_cost": base_meta.get("input_cost", 0.0),
                "output_cost": base_meta.get("output_cost", 0.0),
                "max_tokens": base_meta.get("max_tokens", 16384),
                "max_turns": base_meta.get("max_turns", 6),
                "max_calls": base_meta.get("max_calls", 50),
            }
            if base_meta.get("thinking_level"):
                metadata["thinking_level"] = base_meta["thinking_level"]
            return json.dumps(metadata)

        def build_form_data():
            form = aiohttp.FormData()
            if image_bytes is not None:
                form.add_field(
                    "image",
                    image_bytes,
                    filename="composite.png",
                    content_type="image/png",
                )
            else:
                form._is_multipart = True
            form.add_field("message", instruction)
            form.add_field("baseJsonString", base_json_string)
            form.add_field("metadata", build_metadata())
            # CARE routing fields
            if context_json_string is not None:
                form.add_field("contextJson", context_json_string)
            if routing_mode is not None:
                form.add_field("routingMode", routing_mode)
            # Image fill data
            if image_data:
                form.add_field("imageData", json.dumps(image_data))
            # Selective import
            if target_slide_indices is not None and len(target_slide_indices) > 0:
                form.add_field(
                    "targetSlideIndices", json.dumps(target_slide_indices)
                )
            # XML-specific: ID mapping
            form.add_field(
                "xmlIdMapping", json.dumps(self._current_id_mapping)
            )
            return form

        for attempt in range(1):
            try:
                self.logger.info(
                    f"Calling {endpoint} (attempt {attempt + 1}/1)"
                )
                form_data = build_form_data()
                async with session.post(
                    f"{self.api_base_url}/{endpoint}", data=form_data
                ) as res:
                    if res.status != 200:
                        self.logger.error(
                            f"Error from server (HTTP {res.status}): "
                            f"{await res.text()}"
                        )
                        return None
                    return await res.json()
            except Exception as e:
                self.logger.warning(f"Request failed: {e}")
                await asyncio.sleep(2)

        self.logger.error(
            f"[SKIP] Failed to get response after 3 retries for {result_name}"
        )
        return None


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run XML ablation experiments for figma-slide evaluation"
    )
    parser = parse_common_args(parser)
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Run in non-interactive auto-save mode",
    )
    parser.add_argument(
        "--cases",
        nargs="+",
        type=int,
        help="Specific case indices to run (0-based)",
    )
    parser.add_argument(
        "--eval-file",
        type=str,
        help="Path to evaluation pairs JSON file",
    )
    parser.add_argument(
        "--results-dir",
        type=str,
        help="Override results directory",
    )
    parser.add_argument(
        "--routing",
        choices=[
            "auto", "llm", "dual_llm", "hybrid",
            "micro", "macro", "systemic", "full", "off",
        ],
        default="auto",
        help="CARE routing mode (same as non-XML experiment)",
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    config = ExperimentConfig.from_args(args)
    setattr(config, "auto", getattr(args, "auto", False))
    config.cases = getattr(args, "cases", [])
    config.routing = getattr(args, "routing", "auto")
    config.eval_file = getattr(args, "eval_file", None)
    config.results_dir = getattr(args, "results_dir", None)
    experiment = FigmaSlideXmlExperiment(config)
    await experiment.run()


if __name__ == "__main__":
    asyncio.run(main())
