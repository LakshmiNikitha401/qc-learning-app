import os
from flask import Flask, jsonify, request, render_template
from sqlalchemy import create_engine, text
from groq import Groq
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.json.ensure_ascii = False 

# Initialize Database Engine
database_url = os.environ.get("DATABASE_URL")
# Add utf8 encoding for Telugu characters
engine = create_engine(database_url + "?sslmode=require&client_encoding=utf8")

# Initialize Groq
groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# --- ROUTES ---

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/sync-progress', methods=['POST'])
def sync_progress():
    data = request.json
    device_id = data.get('device_id')
    
    if not device_id:
        return jsonify({"status": "error", "message": "No device ID"}), 400

    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT learned_ids, incorrect_ids FROM user_progress WHERE device_id = :did"), {"did": device_id})
            row = result.fetchone()

            if row:
                return jsonify({"status": "success", "learned_ids": row[0] or [], "incorrect_ids": row[1] or []})
            else:
                conn.execute(text("INSERT INTO user_progress (device_id) VALUES (:did)"), {"did": device_id})
                conn.commit()
                return jsonify({"status": "success", "learned_ids": [], "incorrect_ids": []})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/save-progress', methods=['POST'])
def save_progress():
    data = request.json
    device_id = data.get('device_id')
    learned_ids = data.get('learned_ids', [])
    incorrect_ids = data.get('incorrect_ids', [])

    try:
        with engine.connect() as conn:
            conn.execute(
                text("UPDATE user_progress SET learned_ids = :learned, incorrect_ids = :incorrect, updated_at = now() WHERE device_id = :did"),
                {"learned": learned_ids, "incorrect": incorrect_ids, "did": device_id}
            )
            conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/next-word', methods=['POST'])
def get_next_word():
    try:
        data = request.json
        learned_ids = data.get('learned_ids', [])
        incorrect_ids = data.get('incorrect_ids', [])
        
        with engine.connect() as conn:
            # 1. Try to get incorrect words first (Review)
            if incorrect_ids:
                query = text("SELECT * FROM vocabulary WHERE id = ANY(:incorrect_ids) ORDER BY RANDOM() LIMIT 1;")
                result = conn.execute(query, {"incorrect_ids": incorrect_ids})
                row = result.fetchone()
                if row:
                    word_data = dict(row._mapping)
                    word_data['is_review'] = True
                    if 'created_at' in word_data: word_data['created_at'] = str(word_data['created_at'])
                    return jsonify({"status": "success", "word": word_data})

            # 2. Get new unlearned words
            if learned_ids:
                query = text("SELECT * FROM vocabulary WHERE id != ALL(:learned_ids) ORDER BY RANDOM() LIMIT 1;")
                result = conn.execute(query, {"learned_ids": learned_ids})
            else:
                query = text("SELECT * FROM vocabulary ORDER BY RANDOM() LIMIT 1;")
                result = conn.execute(query)
            
            row = result.fetchone()
            
            if row:
                word_data = dict(row._mapping)
                word_data['is_review'] = False
                if 'created_at' in word_data: word_data['created_at'] = str(word_data['created_at'])
                return jsonify({"status": "success", "word": word_data})
            else:
                return jsonify({"status": "success", "word": None})
                
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/generate-quiz', methods=['POST'])
def generate_quiz():
    data = request.json
    learned_words = data.get('words', []) 
    if not learned_words:
        return jsonify({"status": "error", "message": "No words provided"})

    words_list = "\n".join([f"- Word: {w.get('word')}, Meaning: {w.get('eng_meaning')}, ID: {w.get('id')}" for w in learned_words])

    prompt = f"""
    You are a QC trainer. Create exactly 3 multiple-choice questions to test these words:
    {words_list}
    
    Return ONLY a valid JSON array. Do not wrap in markdown.
    Format:
    [{{"question": "What is the meaning of [Word]?", "options": ["A", "B", "C", "D"], "correct_index": 0, "word_id": 1}}]
    """
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="openai/gpt-oss-120b", temperature=0.3,
        )
        quiz_data = chat_completion.choices[0].message.content.replace("```json", "").replace("```", "").strip()
        return jsonify({"status": "success", "quiz": quiz_data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/generate-report', methods=['POST'])
def generate_report():
    data = request.json
    observed = data.get('observed')
    required = data.get('required')
    part_name = data.get('part_name', 'Enclosure')

    if not observed:
        return jsonify({"status": "error", "message": "Observed defect is required."})

    prompt = f"""
    You are a senior Quality Control (QC) engineer writing a formal defect report for a metal casting/machining factory.
    The part being inspected is a {part_name}.
    The inspector observed: "{observed}"
    The required specification is: "{required if required else 'Standard drawing specifications'}"
    
    Write a single, professional, and concise sentence for the QC report describing this defect. 
    Do not use conversational filler. Example: "Non-conformance observed: The internal bore diameter is undersized compared to the specified drawing requirements."
    """

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="openai/gpt-oss-120b", temperature=0.4,
        )
        return jsonify({"status": "success", "report": chat_completion.choices[0].message.content.strip()})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
