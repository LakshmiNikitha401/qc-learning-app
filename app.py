import os
from flask import Flask, jsonify, request, render_template
from sqlalchemy import create_engine, text
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.json.ensure_ascii = False 

database_url = os.environ.get("DATABASE_URL")
engine = create_engine(database_url + "?sslmode=require&client_encoding=utf8")
groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/sync-progress', methods=['POST'])
def sync_progress():
    """Gets or updates user progress based on device ID"""
    data = request.json
    device_id = data.get('device_id')
    
    if not device_id:
        return jsonify({"status": "error", "message": "No device ID"}), 400

    try:
        with engine.connect() as conn:
            # Check if user exists
            result = conn.execute(text("SELECT learned_ids, incorrect_ids FROM user_progress WHERE device_id = :did"), {"did": device_id})
            row = result.fetchone()

            if row:
                # User exists, return their progress
                return jsonify({
                    "status": "success", 
                    "learned_ids": row[0] or [], 
                    "incorrect_ids": row[1] or []
                })
            else:
                # New user, create a record
                conn.execute(text("INSERT INTO user_progress (device_id) VALUES (:did)"), {"did": device_id})
                conn.commit()
                return jsonify({"status": "success", "learned_ids": [], "incorrect_ids": []})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/save-progress', methods=['POST'])
def save_progress():
    """Saves learned and incorrect words to the database"""
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
            # 1. First, try to get a word the user got WRONG previously
            if incorrect_ids:
                query = text("SELECT * FROM vocabulary WHERE id = ANY(:incorrect_ids) ORDER BY RANDOM() LIMIT 1;")
                result = conn.execute(query, {"incorrect_ids": incorrect_ids})
                row = result.fetchone()
                if row:
                    word_data = dict(row._mapping)
                    word_data['is_review'] = True # Flag it so we know it's a review
                    if 'created_at' in word_data: word_data['created_at'] = str(word_data['created_at'])
                    return jsonify({"status": "success", "word": word_data})

            # 2. If no incorrect words left, get a brand new unlearned word
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

    words_list = "\n".join([f"- Word: {w.get('word')}, Meaning: {w.get('eng_meaning')}" for w in learned_words])

    prompt = f"""
    You are a Quality Control (QC) trainer. I am teaching factory workers English vocabulary.
    Here are the last 10 words the student learned:
    {words_list}

    Create exactly 3 multiple-choice quiz questions to test their memory.
    Return ONLY a valid JSON array of objects. Do not wrap it in markdown blocks.
    
    The JSON must follow this exact structure:
    [
      {{
        "question": "What is the meaning of [Word]?",
        "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
        "correct_index": 0,
        "word_id": 1
      }}
    ]
    Rules:
    - The options must be short English definitions.
    - Only ONE option should be correct.
    - `correct_index` must be an integer (0, 1, 2, or 3) pointing to the correct option.
    - `word_id` must be the ID of the word being tested (check the list I provided).
    """

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="openai/gpt-oss-120b", 
            temperature=0.3, 
        )
        quiz_data = chat_completion.choices[0].message.content
        quiz_data = quiz_data.replace("```json", "").replace("```", "").strip()
        return jsonify({"status": "success", "quiz": quiz_data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)