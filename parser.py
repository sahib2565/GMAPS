import json
import sys
import argparse

def parse_log_file(file_path):
    result = {
        "data": [],
        "metadata": {},
        "metrics": {}
    }
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as e:
                    print(f"Warning: Line {line_num} is not valid JSON and will be skipped. Error: {e}", file=sys.stderr)
                    continue
                
                # Check if this is a metadata/metrics log line
                if "log_type" in record:
                    if "meta" in record:
                        result["metadata"].update(record["meta"])
                    if "metrics" in record:
                        result["metrics"].update(record["metrics"])
                else:
                    # It is a step record
                    step_data = {}
                    # Copy known fields if they exist
                    fields = [
                        "id", "x", "y", "z", "time", "details", "text",
                        "pred", "label", "correct", "input", "output", "error"
                    ]
                    for field in fields:
                        if field in record:
                            step_data[field] = record[field]
                    
                    # Capture any other extra fields in step if they exist
                    for key, value in record.items():
                        if key not in fields:
                            step_data[key] = value
                            
                    result["data"].append(step_data)
                    
    except FileNotFoundError:
        print(f"Error: File not found at {file_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error reading file: {e}", file=sys.stderr)
        sys.exit(1)
        
    return result

def main():
    parser = argparse.ArgumentParser(description="Parse JSON Lines log files into a structured JSON.")
    parser.add_argument("input_file", help="Path to the JSON Lines log file.")
    parser.add_argument("-o", "--output", help="Path to save the output JSON. If not specified, prints to stdout.")
    parser.add_argument("--indent", type=int, default=2, help="JSON indentation level (default: 2).")
    
    args = parser.parse_args()
    
    parsed_data = parse_log_file(args.input_file)
    
    if args.output:
        try:
            with open(args.output, 'w', encoding='utf-8') as f:
                json.dump(parsed_data, f, indent=args.indent)
            print(f"Successfully wrote output to {args.output}")
        except Exception as e:
            print(f"Error writing output file: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print(json.dumps(parsed_data, indent=args.indent))

if __name__ == "__main__":
    main()
