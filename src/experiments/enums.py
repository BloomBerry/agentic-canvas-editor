from enum import Enum, auto


class ExperimentVariant(str, Enum):
    IMAGE_ONLY = "image_only"


class ModelType(str, Enum):
    GPT4o = "gpt-4o"
    GPT41 = "gpt-4.1"
    CLAUDE35 = "claude-3-5-sonnet"
    CLAUDE_OPUS_46 = "claude-opus-4-6"
    CLAUDE_SONNET_46 = "claude-sonnet-4-6"
    GEMINI25FLASH = "gemini-2.5-flash"
    GPT52 = "gpt-5.2"
    GPT55 = "gpt-5.5"
    GEMINI25PRO = "gemini-2.5-pro"
    GEMINI31PRO = "gemini-3.1-pro"
    GEMINI3FLASH = "gemini-3-flash-preview"
    GEMINI35FLASH = "gemini-3.5-flash"


class Channel(str, Enum):
    CHANNEL_1 = "channel_1"
    CHANNEL_2 = "channel_2"
    CHANNEL_3 = "channel_3"
    CHANNEL_4 = "channel_4"
    CHANNEL_5 = "channel_5"
    CHANNEL_6 = "channel_6"
    CHANNEL_7 = "channel_7"


class TaskType(str, Enum):
    MODIFICATION = "modification"
    GENERATION = "generation"
    SAMPLE = "sample"


class AgentType(str, Enum):
    REACT_REPLICATION = "react_replication"
    CODE_REPLICATION = "code_replication"
    SINGLE_REPLICATION = "single_replication"
    REACT_MODIFICATION = "react_modification"
    SINGLE_MODIFICATION = "single_modification"
    SINGLE_FIGMA_SLIDE = "single_figma_slide"
