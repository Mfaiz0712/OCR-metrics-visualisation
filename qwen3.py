import torch
from transformers import AutoProcessor, Qwen3VLForConditionalGeneration
from qwen_vl_utils import process_vision_info

# 1. Define model ID and output file path
model_id = "Qwen/Qwen3-VL-8B-Instruct"
image_path = "0000031.jpg" # Make sure to update this!
output_file_path = "extracted_urdu_text.txt"

# 2. Load the model and processor
print(f"Loading {model_id} and processor...")

# FIX 1 & 2: Use Qwen3VLForConditionalGeneration and `dtype` instead of `torch_dtype`
model = Qwen3VLForConditionalGeneration.from_pretrained(
    "/home/tahseen/scratch/VL_Models/models--Qwen--Qwen3-VL-8B-Instruct/snapshots/0c351dd01ed87e9c1b53cbc748cba10e6187ff3b",
    dtype=torch.float16,
    device_map="auto",
    attn_implementation="flash_attention_2"
)

# Initialize the processor
processor = AutoProcessor.from_pretrained(model_id)

# 3. Construct the prompt message format
messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "image", 
                "image": image_path
            },
            {
                "type": "text", 
                "text": "Extract all the Urdu text from this document image. Preserve the layout, paragraphs, and formatting as accurately as possible."
            },
        ],
    }
]

# 4. Process the vision and text inputs
print("Processing multimodal inputs...")
text = processor.apply_chat_template(
    messages, tokenize=False, add_generation_prompt=True,
    enable_thinking=False  # Disable Qwen3 internal thinking to prevent hallucination
)

image_inputs, video_inputs = process_vision_info(messages)

inputs = processor(
    text=[text],
    images=image_inputs,
    videos=video_inputs,
    padding=True,
    return_tensors="pt",
)

# Move inputs to the designated model device
inputs = inputs.to(model.device)

# 5. Generate the output
print("Running OCR inference...")
with torch.no_grad():
    generated_ids = model.generate(
        **inputs, 
        max_new_tokens=2048, 
        do_sample=True,           # Enable sampling for better quality
        temperature=0.1,          # Low temperature for near-deterministic but diverse output
        top_p=0.9,                # Nucleus sampling to constrain token distribution
        repetition_penalty=1.2,   # Penalize repeated tokens to break repetition loops
    )

# 6. Post-process the output
generated_ids_trimmed = [
    out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
]

output_text = processor.batch_decode(
    generated_ids_trimmed, 
    skip_special_tokens=True, 
    clean_up_tokenization_spaces=False
)

# 7. Write the extracted Urdu text to a file
print(f"Writing extracted text to {output_file_path}...")
with open(output_file_path, "w", encoding="utf-8") as file:
    file.write(output_text[0])

print("Done!")