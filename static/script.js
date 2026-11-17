// --- STATE MANAGEMENT ---
let deviceId = localStorage.getItem('qc_device_id');
if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('qc_device_id', deviceId);
}

let wordsLearned = [];      
let incorrectWords = [];    
let currentSessionWords = []; 

let currentWordData = null;
let currentQuizData = [];
let currentQuestionIndex = 0;

// DOM Elements
const learningScreen = document.getElementById('learning-screen');
const quizScreen = document.getElementById('quiz-screen');
const matchingScreen = document.getElementById('matching-screen');
const wordDisplay = document.getElementById('word-display');
const engMeaning = document.getElementById('eng-meaning');
const telMeaning = document.getElementById('tel-meaning');
const userInput = document.getElementById('user-input');
const submitBtn = document.getElementById('submit-btn');
const feedbackMsg = document.getElementById('feedback-msg');
const progressBar = document.getElementById('progress-bar');

// --- INITIALIZATION ---
async function initApp() {
    wordDisplay.textContent = "Syncing...";
    try {
        const response = await fetch('/api/sync-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId })
        });
        const data = await response.json();
        if (data.status === "success") {
            wordsLearned = data.learned_ids || [];
            incorrectWords = data.incorrect_ids || [];
        }
    } catch (e) {
        console.error("Sync failed.");
    }
    updateProgress();
    fetchNextWord();
}

// --- LEARNING LOGIC ---
async function fetchNextWord() {
    userInput.value = "";
    userInput.disabled = true;
    submitBtn.disabled = true;
    feedbackMsg.textContent = "";
    wordDisplay.textContent = "Loading...";

    try {
        const response = await fetch('/api/next-word', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ learned_ids: wordsLearned, incorrect_ids: incorrectWords })
        });
        const data = await response.json();

        if (data.status === "success") {
            if (data.word) {
                currentWordData = data.word;
                wordDisplay.textContent = currentWordData.word;
                if (currentWordData.is_review) wordDisplay.textContent += " (Review)";
                engMeaning.textContent = currentWordData.eng_meaning;
                telMeaning.textContent = currentWordData.tel_meaning;
                
                userInput.disabled = false;
                submitBtn.disabled = false;
                userInput.focus();
            } else {
                wordDisplay.textContent = "All Words Mastered 🎉";
                engMeaning.textContent = "You have successfully learned all vocabulary.";
                userInput.style.display = "none";
                submitBtn.style.display = "none";
            }
        }
    } catch (error) {
        wordDisplay.textContent = "Connection Error.";
    }
}

async function checkSpelling() {
    const typedWord = userInput.value.trim().toLowerCase();
    const actualWord = currentWordData.word.toLowerCase();

    if (typedWord === actualWord) {
        feedbackMsg.textContent = "Correct! ✔";
        feedbackMsg.className = "feedback-text correct";
        
        if (!wordsLearned.includes(currentWordData.id)) {
            wordsLearned.push(currentWordData.id);
            currentSessionWords.push(currentWordData);
        }

        const incorrectIndex = incorrectWords.indexOf(currentWordData.id);
        if (incorrectIndex > -1) incorrectWords.splice(incorrectIndex, 1);

        await fetch('/api/save-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, learned_ids: wordsLearned, incorrect_ids: incorrectWords })
        });

        userInput.disabled = true;
        submitBtn.disabled = true;

        if (currentSessionWords.length > 0 && currentSessionWords.length % 10 === 0) {
            setTimeout(() => {
                const isMatching = Math.random() > 0.5; 
                if (isMatching) startMatchingGame();
                else startQuiz();
            }, 1000);
        } else {
            setTimeout(fetchNextWord, 1000); 
        }
    } else {
        feedbackMsg.textContent = "Incorrect, try again. ✖";
        feedbackMsg.className = "feedback-text incorrect";
        
        if (!incorrectWords.includes(currentWordData.id)) {
            incorrectWords.push(currentWordData.id);
            fetch('/api/save-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: deviceId, learned_ids: wordsLearned, incorrect_ids: incorrectWords })
            });
        }
    }
}

function updateProgress() {
    const progressPercent = (wordsLearned.length / 65) * 100;
    progressBar.style.width = `${Math.min(progressPercent, 100)}%`;
}

// --- QUIZ LOGIC ---
async function startQuiz() {
    learningScreen.style.display = 'none';
    quizScreen.style.display = 'block';
    document.getElementById('quiz-feedback').textContent = "Generating AI Quiz...";
    document.getElementById('quiz-options').innerHTML = "";

    const wordsForQuiz = currentSessionWords.slice(-10);

    try {
        const response = await fetch('/api/generate-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: wordsForQuiz })
        });
        const data = await response.json();
        
        if (data.status === "success") {
            currentQuizData = JSON.parse(data.quiz);
            currentQuestionIndex = 0;
            document.getElementById('quiz-feedback').textContent = "";
            showQuestion();
        } else {
            endQuiz(); 
        }
    } catch (error) { endQuiz(); }
}

function showQuestion() {
    if (currentQuestionIndex >= currentQuizData.length) return endQuiz();

    const q = currentQuizData[currentQuestionIndex];
    document.getElementById('quiz-progress').textContent = `Question ${currentQuestionIndex + 1} of ${currentQuizData.length}`;
    document.getElementById('quiz-question').textContent = q.question;
    const optionsDiv = document.getElementById('quiz-options');
    optionsDiv.innerHTML = "";

    q.options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.textContent = option;
        btn.onclick = () => checkAnswer(index, q, btn);
        optionsDiv.appendChild(btn);
    });
}

function checkAnswer(selectedIndex, questionData, btnElement) {
    const allBtns = document.getElementById('quiz-options').children;
    Array.from(allBtns).forEach(b => b.disabled = true);
    const fb = document.getElementById('quiz-feedback');

    if (selectedIndex === questionData.correct_index) {
        btnElement.style.borderColor = "#81c995"; btnElement.style.color = "#81c995";
        fb.textContent = "Correct!"; fb.className = "feedback-text correct";
    } else {
        btnElement.style.borderColor = "#f28b82"; btnElement.style.color = "#f28b82";
        allBtns[questionData.correct_index].style.borderColor = "#81c995";
        allBtns[questionData.correct_index].style.color = "#81c995";
        fb.textContent = "Incorrect"; fb.className = "feedback-text incorrect";
        
        const wrongWordId = questionData.word_id;
        if (wrongWordId && !incorrectWords.includes(wrongWordId)) {
            incorrectWords.push(wrongWordId);
            fetch('/api/save-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: deviceId, learned_ids: wordsLearned, incorrect_ids: incorrectWords })
            });
        }
    }
    setTimeout(() => { currentQuestionIndex++; showQuestion(); }, 1500);
}

function endQuiz() {
    quizScreen.style.display = 'none';
    learningScreen.style.display = 'block';
    fetchNextWord();
}

// --- MATCHING GAME ---
function startMatchingGame() {
    learningScreen.style.display = 'none';
    matchingScreen.style.display = 'block';
    
    const gameWords = currentSessionWords.slice(-10).sort(() => 0.5 - Math.random()).slice(0, 4);
    const wordsCol = document.getElementById('words-col');
    const meaningsCol = document.getElementById('meanings-col');
    wordsCol.innerHTML = ""; meaningsCol.innerHTML = "";

    const shuffledMeanings = [...gameWords].sort(() => 0.5 - Math.random());

    gameWords.forEach(w => {
        const div = document.createElement('div');
        div.className = "match-item word"; div.draggable = true; div.textContent = w.word; div.dataset.id = w.id;
        div.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', w.id); div.classList.add('dragging'); });
        div.addEventListener('dragend', () => div.classList.remove('dragging'));
        wordsCol.appendChild(div);
    });

    shuffledMeanings.forEach(w => {
        const div = document.createElement('div');
        div.className = "match-item meaning"; div.textContent = w.eng_meaning; div.dataset.matchId = w.id;
        div.addEventListener('dragover', (e) => { e.preventDefault(); div.classList.add('drag-over'); });
        div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
        div.addEventListener('drop', (e) => {
            e.preventDefault(); div.classList.remove('drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId === div.dataset.matchId) {
                div.classList.add('matched'); div.textContent = "✔ Matched";
                const draggedEl = document.querySelector(`.match-item.word[data-id="${draggedId}"]`);
                if(draggedEl) draggedEl.style.visibility = "hidden";
                checkMatchingWin();
            } else {
                div.style.borderColor = "#f28b82"; setTimeout(() => div.style.borderColor = "#333537", 500);
            }
        });
        meaningsCol.appendChild(div);
    });
}

function checkMatchingWin() {
    if (document.querySelectorAll('.match-item.meaning.matched').length === 4) {
        const fb = document.getElementById('match-feedback');
        fb.textContent = "Great job! All matched."; fb.className = "feedback-text correct";
        setTimeout(() => { matchingScreen.style.display = 'none'; learningScreen.style.display = 'block'; document.getElementById('match-feedback').textContent = ""; fetchNextWord(); }, 2000);
    }
}

// --- REPORT ASSISTANT LOGIC ---
function openReportScreen() {
    learningScreen.style.display = 'none';
    document.getElementById('report-screen').style.display = 'block';
}

function closeReportScreen() {
    document.getElementById('report-screen').style.display = 'none';
    document.getElementById('report-output-box').style.display = 'none';
    learningScreen.style.display = 'block';
    document.getElementById('report-part').value = ""; document.getElementById('report-observed').value = ""; document.getElementById('report-required').value = "";
}

async function generateReport() {
    const part = document.getElementById('report-part').value;
    const observed = document.getElementById('report-observed').value;
    const required = document.getElementById('report-required').value;

    if (!observed) { alert("Please describe what you observed."); return; }

    const btn = document.getElementById('generate-report-btn');
    const outputBox = document.getElementById('report-output-box');
    const resultText = document.getElementById('report-result-text');

    btn.textContent = "Generating AI Sentence..."; btn.disabled = true; outputBox.style.display = 'none';

    try {
        const response = await fetch('/api/generate-report', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ part_name: part, observed: observed, required: required })
        });
        const data = await response.json();
        
        if (data.status === "success") {
            resultText.textContent = data.report;
            outputBox.style.display = 'block';
        } else { alert("Error generating report: " + data.message); }
    } catch (error) { alert("Connection error."); } finally {
        btn.textContent = "Generate Report Sentence"; btn.disabled = false;
    }
}

function copyReport() {
    const text = document.getElementById('report-result-text').textContent;
    navigator.clipboard.writeText(text).then(() => { alert("Report sentence copied!"); });
}

// Event Listeners
submitBtn.addEventListener('click', checkSpelling);
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') checkSpelling(); });

// Start
initApp();
