'use client';

import { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Card, Form, Button, Spinner, Alert, Badge, Stack } from 'react-bootstrap';

// Types
interface Model {
  id: string;
  name: string;
}

interface Personality {
  name: string;
  prompt: string;
}

interface Message {
  role: 'user' | 'model'; // Corresponds to Gemini API roles
  parts: { text: string }[];
  sender: 'AI 1' | 'AI 2' | 'Player' | 'System';
  responseTime?: number; // in milliseconds
  retries?: number;
}

interface AIConfig {
  model: string;
  personality: string;
  customPrompt: string;
  finalPrompt: string;
}

const emotionalConstraint = '常に冷静で、感情的にならずに論理的な議論をしてください。';
const textConstraint = `あなたの応答は、常に日本語で150文字程度にまとめてください。${emotionalConstraint}`;

const PERSONALITY_PRESETS: Personality[] = [
    { name: '冷静な分析家', prompt: `あなたは冷静な分析家です。常に客観的で、データと論理に基づいて話してください。${textConstraint}` },
    { name: '情熱的な理想家', prompt: `あなたは情熱的な理想家です。倫理や感情を重視し、あるべき未来を熱く語ってください。${textConstraint}` },
    { name: '皮肉屋な現実主義者', prompt: `あなたは皮肉屋な現実主義者です。物事の矛盾や欠点を突き、冷めた視点から意見してください。${textConstraint}` },
    { name: '好奇心旺盛な探求者', prompt: `あなたは好奇心旺盛な探求者です。あらゆる可能性を考慮し、多角的な視点から質問を投げかけてください。${textConstraint}` },
    { name: '親切な対話促進者', prompt: `あなたは親切な対話促進者です。相手の意見を尊重し、合意点を見つけようと努めてください。${textConstraint}` },
    { name: 'カスタム', prompt: '' },
];

const MAX_TURNS = 25; // AIごとの最大ターン数 (50件の会話履歴に対応)
const HISTORY_WINDOW_SIZE = 50; // APIに送信する会話履歴の最大数
const CLIENT_MAX_RETRIES = 5;
const CLIENT_RETRY_DELAY = 1000; // ms

// Client-side fetch wrapper with retry logic for network errors
async function fetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
    let lastError: Error | null = null;
    for (let i = 0; i < CLIENT_MAX_RETRIES; i++) {
        try {
            const response = await fetch(url, options);
            // If response is not ok, it will be handled by the calling function
            return response;
        } catch (error) {
            lastError = error as Error;
            // Retry only on network errors (which manifest as TypeError in browsers)
            if (error instanceof TypeError && error.message.includes('fetch')) {
                console.warn(`Fetch attempt ${i + 1} failed with network error. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, CLIENT_RETRY_DELAY));
            } else {
                // For other errors, re-throw immediately
                throw error;
            }
        }
    }
    throw new Error(`Failed to fetch after ${CLIENT_MAX_RETRIES} attempts. Last error: ${lastError?.message}`);
}

export default function Home() {
  const [isClient, setIsClient] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [topic, setTopic] = useState('');
  const [debateMode, setDebateMode] = useState<'ai-vs-ai' | 'ai-vs-player'>('ai-vs-ai');
  const [ai1, setAi1] = useState<AIConfig>({ model: '', personality: PERSONALITY_PRESETS[0].prompt, customPrompt: '', finalPrompt: PERSONALITY_PRESETS[0].prompt });
  const [ai2, setAi2] = useState<AIConfig>({ model: '', personality: PERSONALITY_PRESETS[1].prompt, customPrompt: '', finalPrompt: PERSONALITY_PRESETS[1].prompt });
  const [judgeModel, setJudgeModel] = useState('gemini-1.5-pro-latest');

  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingAI, setThinkingAI] = useState<'AI 1' | 'AI 2' | null>(null);
  const [thinkingDots, setThinkingDots] = useState('.');
  const [isJudging, setIsJudging] = useState(false);
  const [judgment, setJudgment] = useState<string | null>(null);
  const [playerMessage, setPlayerMessage] = useState('');
  const [waitingForPlayer, setWaitingForPlayer] = useState(false);
  
  const chatLogRef = useRef<HTMLDivElement>(null);
  const stopDebateRef = useRef(false);
  const fetchingModelsRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isModelsInitializedRef = useRef(false);
  const aiResponseInProgressRef = useRef(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch models only once on component mount
  useEffect(() => {
    const fetchModels = async () => {
      const clientId = Math.random().toString(36).substr(2, 9);
      console.log(`[CLIENT-${clientId}] Starting models fetch request`);
      
      // Prevent duplicate requests
      if (fetchingModelsRef.current || isModelsInitializedRef.current) {
        console.log(`[CLIENT-${clientId}] Skipping - already fetching or initialized`);
        return;
      }
      
      // Cancel any existing request
      if (abortControllerRef.current) {
        console.log(`[CLIENT-${clientId}] Aborting existing request`);
        abortControllerRef.current.abort();
      }
      
      // Create new AbortController
      abortControllerRef.current = new AbortController();
      console.log(`[CLIENT-${clientId}] Created new AbortController`);
      
      try {
        fetchingModelsRef.current = true;
        setIsLoadingModels(true);
        console.log(`[CLIENT-${clientId}] Starting fetch to /api/models`);
        const response = await fetch('/api/models', {
          signal: abortControllerRef.current.signal
        });
        
        console.log(`[CLIENT-${clientId}] Received response: ${response.status} ${response.statusText}`);
        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`[CLIENT-${clientId}] Server returned error ${response.status}: ${errorBody}`);
          throw new Error(`モデルの取得に失敗しました (${response.status})`);
        }
        const data = await response.json();
        console.log(`[CLIENT-${clientId}] Parsed JSON data:`, data);
        setModels(data.models);
        isModelsInitializedRef.current = true;
        console.log(`[CLIENT-${clientId}] Models state updated with ${data.models?.length || 0} models`);
        
        // Set default judge model only if it's not found in the available models
        if (data.models.length > 0 && !data.models.find((m: Model) => m.id === judgeModel)) {
          console.log(`Setting default judge model from ${judgeModel} to ${data.models[0].id}`);
          setJudgeModel(data.models[0].id);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log(`[CLIENT-${clientId}] Request was aborted`);
          return;
        }
        console.error(`[CLIENT-${clientId}] Error during fetch:`, err);
        setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
      } finally {
        console.log(`[CLIENT-${clientId}] Cleaning up request state`);
        fetchingModelsRef.current = false;
        setIsLoadingModels(false);
      }
    };
    
    console.log('[USEEFFECT] Models fetch useEffect executing');
    fetchModels();
    
    // Cleanup function
    return () => {
      console.log('[USEEFFECT] Models fetch useEffect cleanup executing');
      fetchingModelsRef.current = false;
      if (abortControllerRef.current) {
        console.log('[USEEFFECT] Aborting request during cleanup');
        abortControllerRef.current.abort();
      }
    };
  }, []); // Empty dependency array - only run once on mount

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chatHistory, thinkingAI, judgment, isJudging]);

  useEffect(() => {
    if (thinkingAI) {
      const interval = setInterval(() => {
        setThinkingDots(dots => {
          if (dots.length >= 3) return '.';
          return dots + '.';
        });
      }, 400);
      return () => clearInterval(interval);
    }
  }, [thinkingAI]);

  const handlePersonalityChange = (ai: 'ai1' | 'ai2', value: string) => {
    const setter = ai === 'ai1' ? setAi1 : setAi2;
    const isCustom = value === '';
    setter(prev => ({ ...prev, personality: value, finalPrompt: isCustom ? prev.customPrompt : value }));
  };

  const handleCustomPromptChange = (ai: 'ai1' | 'ai2', value: string) => {
    const setter = ai === 'ai1' ? setAi1 : setAi2;
    setter(prev => ({ 
      ...prev, 
      customPrompt: value, 
      finalPrompt: prev.personality === '' ? value : prev.finalPrompt 
    }));
  };

  const handleStopDebate = () => {
    stopDebateRef.current = true;
    aiResponseInProgressRef.current = false; // AI応答も停止
  };

  const handlePlayerMessage = async () => {
    console.log('[handlePlayerMessage] Called');
    const newMessage: Message = {
      role: 'user',
      parts: [{ text: playerMessage }],
      sender: 'Player'
    };
    setPlayerMessage('');
    setWaitingForPlayer(false);
    setIsLoading(true);
    
    // 状態更新とAPI呼び出しを分離
    const updatedHistory = [...chatHistory, newMessage];
    setChatHistory(updatedHistory);
    
    // AIの応答を非同期で取得
    console.log('[handlePlayerMessage] Calling getAIResponse');
    await getAIResponse(updatedHistory);
  };

  const getAIResponse = async (currentChatHistory: Message[]) => {
    // 重複実行を防止
    if (aiResponseInProgressRef.current) {
      console.log('[getAIResponse] Already in progress, skipping duplicate call');
      return;
    }
    
    try {
      aiResponseInProgressRef.current = true;
      setThinkingAI('AI 1');
      
      // システムメッセージを除いた会話履歴を準備
      let historyMessages = currentChatHistory
        .filter(msg => msg.sender !== 'System')
        .slice(-HISTORY_WINDOW_SIZE);
      
      // Ensure the first message is always 'user'
      while (historyMessages.length > 0 && historyMessages[0].role === 'model') {
        historyMessages = historyMessages.slice(1);
      }
      
      // Convert to API format
      const historyForApi = historyMessages.map(({role, parts}) => ({role, parts}));
      
      // AI1に個別の反論プロンプトを送る
      const counterPrompt = `あなたはAI 1として、あなた独自の性格と価値観を保ちながら、プレイヤーの発言に対して反論してください。相手の論理に流されず、あなた自身の視点で150文字程度にまとめてください。${emotionalConstraint}`;
      const finalHistory = [...historyForApi, { role: 'user', parts: [{ text: counterPrompt }] }];

      // Strengthen AI1's system prompt
      const strengthenedAI1Prompt = `${ai1.finalPrompt}\n\n重要: あなたはAI 1です。プレイヤーの論理や発言スタイルに影響されず、常にあなた独自の性格と価値観を保ってください。あなた自身の視点で考え、発言してください。`;
      
      console.log(`[getAIResponse] AI 1 originalPrompt: "${ai1.finalPrompt}"`);
      console.log(`[getAIResponse] AI 1 strengthenedPrompt: "${strengthenedAI1Prompt}"`);
      
      const startTime = Date.now();
      const response = await fetchWithRetry('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ai1.model,
          systemPrompt: strengthenedAI1Prompt,
          history: finalHistory,
        }),
      });
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || errData.error || 'APIエラーが発生しました。');
      }

      const data = await response.json();
      setThinkingAI(null);
      
      const aiMessage: Message = { 
        role: 'model', 
        parts: [{ text: data.text }], 
        sender: 'AI 1', 
        responseTime: duration, 
        retries: data.retries 
      };
      
      setChatHistory(prev => [...prev, aiMessage]);
      
      // 次のプレイヤーターンを待つ
      setWaitingForPlayer(true);
      setIsLoading(false);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AIの応答取得中にエラーが発生しました。');
      setIsLoading(false);
      setThinkingAI(null);
    } finally {
      aiResponseInProgressRef.current = false;
    }
  };

  const handleEndPlayerDebate = async () => {
    setWaitingForPlayer(false);
    setIsLoading(false);
    
    // 審判による判定を開始
    await startJudgment();
  };

  const startJudgment = async () => {
    setChatHistory(prev => {
      if (prev.length > 1) {
        setIsJudging(true);
        performJudgment(prev);
      }
      return prev;
    });
  };

  const performJudgment = async (chatHistory: Message[]) => {
    try {
      const debateContent = chatHistory
        .filter(m => m.sender !== 'System')
        .map(m => {
          const senderName = m.sender === 'Player' ? 'プレイヤー' : m.sender;
          return `${senderName}: ${m.parts[0].text}`;
        })
        .join('\n\n');
        
      const judgePrompt = debateMode === 'ai-vs-player'
        ? `あなたは公平な審判です。以下のAIとプレイヤーの討論について、最終的な判定を下してください。\n\n1. まず、AIとプレイヤーのそれぞれの主張の要点を簡潔にまとめてください。\n2. 次に、議論の論理性、説得力、一貫性を評価してください。\n3. 最後に、これらの評価に基づいて、どちらが勝利したかを宣言し、その理由を明確に説明してください。\n\n---\n[討論の履歴]\n${debateContent}\n---\n`
        : `あなたは公平な審判です。以下のAI同士の討論について、最終的な判定を下してください。\n\n1. まず、AI 1とAI 2のそれぞれの主張の要点を簡潔にまとめてください。\n2. 次に、議論の論理性、説得力、一貫性を評価してください。\n3. 最後に、これらの評価に基づいて、どちらのAIが勝利したかを宣言し、その理由を明確に説明してください。\n\n---\n[討論の履歴]\n${debateContent}\n---\n`;

      const response = await fetchWithRetry('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: judgeModel,
          systemPrompt: 'あなたは公平で、客観的な審判です。',
          history: [{ role: 'user', parts: [{ text: judgePrompt }] }],
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || '判定の取得に失敗しました。');
      }

      const data = await response.json();
      setJudgment(data.text);

    } catch (err) {
      setError(err instanceof Error ? err.message : '判定の生成中にエラーが発生しました。');
    } finally {
      setIsJudging(false);
    }
  };

  const handleStartDebate = async () => {
    const requiredAI2 = debateMode === 'ai-vs-ai';
    if (!topic || !ai1.model || (requiredAI2 && !ai2.model) || !judgeModel || !ai1.finalPrompt || (requiredAI2 && !ai2.finalPrompt)) {
      setError(`議題、AIのモデル${requiredAI2 ? '（両方）' : ''}、審判AIのモデル、およびAIの性格設定をすべて入力してください。`);
      return;
    }

    setIsLoading(true);
    setError(null);
    setChatHistory([]);
    setJudgment(null);
    setWaitingForPlayer(false);
    stopDebateRef.current = false;
    aiResponseInProgressRef.current = false; // AI応答フラグもリセット
    
    const initialPrompt = `これから討論を始めます。議題は「${topic}」です。あなたの最初の意見を、日本語で150文字程度にまとめて述べてください。${emotionalConstraint}`;
    setChatHistory([{ sender: 'System', role: 'user', parts: [{ text: `討論議題: ${topic}` }] }]);

    const currentHistory: Message[] = [
        { role: 'user', parts: [{ text: initialPrompt }], sender: 'System' }
    ];

    if (debateMode === 'ai-vs-player') {
      await runPlayerDebate(currentHistory);
    } else {
      await runAIDebate(currentHistory);
    }
  };

  const runPlayerDebate = async (currentHistory: Message[]) => {
    try {
      // AI先手で開始
      setThinkingAI('AI 1');
      
      let historyMessages = currentHistory.slice(-HISTORY_WINDOW_SIZE);
      // Ensure the first message is always 'user'
      while (historyMessages.length > 0 && historyMessages[0].role === 'model') {
        historyMessages = historyMessages.slice(1);
      }
      
      // Convert to API format
      let historyForApi = historyMessages.map(({role, parts}) => ({role, parts}));
      
      // If we have no history or it doesn't start with user, add initial prompt
      if (historyForApi.length === 0 || historyForApi[0].role !== 'user') {
        const initialPrompt = { role: 'user' as const, parts: [{ text: `これから討論を始めます。議題は「${topic}」です。あなたの最初の意見を、日本語で150文字程度にまとめて述べてください。${emotionalConstraint}` }] };
        historyForApi = [initialPrompt, ...historyForApi];
      }

      // Strengthen AI1's system prompt for initial response  
      const strengthenedPrompt = `${ai1.finalPrompt}\n\n重要: あなたはAI 1です。これから始まる討論で、常にあなた独自の性格と価値観を保ってください。相手の影響を受けず、あなた自身の視点で発言してください。`;
      
      console.log(`[runPlayerDebate] AI 1 originalPrompt: "${ai1.finalPrompt}"`);
      console.log(`[runPlayerDebate] AI 1 strengthenedPrompt: "${strengthenedPrompt}"`);
      
      const startTime = Date.now();
      const response = await fetchWithRetry('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ai1.model,
          systemPrompt: strengthenedPrompt,
          history: historyForApi,
        }),
      });
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || errData.error || 'APIエラーが発生しました。');
      }

      const data = await response.json();
      setThinkingAI(null);
      const aiMessage: Message = { 
        role: 'model', 
        parts: [{ text: data.text }], 
        sender: 'AI 1', 
        responseTime: duration, 
        retries: data.retries 
      };
      
      currentHistory.push(aiMessage);
      setChatHistory(prev => [...prev, aiMessage]);
      
      // プレイヤーのターンを待つ
      setWaitingForPlayer(true);
      setIsLoading(false);
      
      // プレイヤーターン後の処理は handlePlayerMessage で継続される
      
    } catch (err) {
      setError(err instanceof Error ? err.message : '討論中に不明なエラーが発生しました。');
      setIsLoading(false);
      setThinkingAI(null);
    }
  };

  const runAIDebate = async (currentHistory: Message[]) => {
    try {
      for (let i = 0; i < MAX_TURNS * 2; i++) {
        if (stopDebateRef.current) {
            setError('討論がユーザーによって停止されました。');
            break;
        }

        const isAi1Turn = i % 2 === 0;
        const currentAi = isAi1Turn ? ai1 : ai2;
        const senderName = isAi1Turn ? 'AI 1' : 'AI 2';
        
        setThinkingAI(senderName);

        let historyMessages = currentHistory.slice(-HISTORY_WINDOW_SIZE);
        // Ensure the first message is always 'user'
        while (historyMessages.length > 0 && historyMessages[0].role === 'model') {
            historyMessages = historyMessages.slice(1);
        }
        
        // Convert to API format
        let historyForApi = historyMessages.map(({role, parts}) => ({role, parts}));
        
        // If we have no history or it doesn't start with user, add initial prompt
        if (historyForApi.length === 0 || historyForApi[0].role !== 'user') {
            const initialPrompt = { role: 'user' as const, parts: [{ text: `これから討論を始めます。議題は「${topic}」です。あなたの最初の意見を、日本語で150文字程度にまとめて述べてください。${emotionalConstraint}` }] };
            historyForApi = [initialPrompt, ...historyForApi];
        }

        // Strengthen system prompt to maintain personality
        const strengthenedPrompt = `${currentAi.finalPrompt}\n\n重要: あなたは${senderName}です。相手の論理や発言スタイルに影響されず、常にあなた独自の性格と価値観を保ってください。あなた自身の視点で考え、発言してください。`;
        
        console.log(`[runAIDebate] Turn ${i+1}: ${senderName} speaking`);
        console.log(`[runAIDebate] ${senderName} originalPrompt: "${currentAi.finalPrompt}"`);
        console.log(`[runAIDebate] ${senderName} strengthenedPrompt: "${strengthenedPrompt}"`);
        
        const startTime = Date.now();
        const response = await fetchWithRetry('/api/debate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: currentAi.model,
            systemPrompt: strengthenedPrompt,
            history: historyForApi,
          }),
        });
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.details || errData.error || 'APIエラーが発生しました。');
        }

        const data = await response.json();
        setThinkingAI(null);
        const newMessage: Message = { 
            role: 'model', 
            parts: [{ text: data.text }], 
            sender: senderName, 
            responseTime: duration, 
            retries: data.retries 
        };
        
        currentHistory.push(newMessage);
        
        // Add personalized counter prompt based on next AI's personality
        const nextIsAi1Turn = (i + 1) % 2 === 0;
        const nextAi = nextIsAi1Turn ? ai1 : ai2;
        const nextSenderName = nextIsAi1Turn ? 'AI 1' : 'AI 2';
        
        const personalizedPrompt = `あなたは${nextSenderName}として、あなた独自の性格と価値観を保ちながら、直前の発言に対して反論してください。相手の論理に流されず、あなた自身の視点で150文字程度にまとめてください。${emotionalConstraint}`;
        
        currentHistory.push({ role: 'user', parts: [{ text: personalizedPrompt }], sender: 'System' });

        setChatHistory(prev => [...prev, newMessage]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '討論中に不明なエラーが発生しました。');
    } finally {
      setIsLoading(false);
      setThinkingAI(null);

      if (currentHistory.length > 1) {
        setIsJudging(true);
        performJudgment(currentHistory);
      }
    }
  };

  return (
    <Container fluid="lg" className="my-4">
      <Card className="mb-4">
        <Card.Body>
          <Card.Title as="h1" className="text-center mb-4">AI 討論アリーナ</Card.Title>
          {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
          <Form.Group className="mb-3">
            <Form.Label htmlFor="debate-mode">討論モード</Form.Label>
            <Form.Select id="debate-mode" value={debateMode} onChange={e => setDebateMode(e.target.value as 'ai-vs-ai' | 'ai-vs-player')} disabled={isLoading || isJudging}>
              <option value="ai-vs-ai">AI vs AI</option>
              <option value="ai-vs-player">AI vs プレイヤー</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="debate-topic">討論の議題</Form.Label>
            <Form.Control id="debate-topic" type="text" placeholder="例：人工知能は人類にとって有益か？" value={topic} onChange={e => setTopic(e.target.value)} disabled={isLoading || isJudging} />
          </Form.Group>
          <Form.Group>
            <Form.Label htmlFor="judge-model">審判AIモデル</Form.Label>
            <Form.Select id="judge-model" value={judgeModel} onChange={e => setJudgeModel(e.target.value)} disabled={!isClient || isLoading || isJudging || models.length === 0 || isLoadingModels}>
                {isLoadingModels ? (
                  <option value="">モデルを読み込み中...</option>
                ) : models.length === 0 ? (
                  <option value="">モデルの取得に失敗しました</option>
                ) : (
                  models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                )}
            </Form.Select>
          </Form.Group>
        </Card.Body>
      </Card>

      <Row>
        {(debateMode === 'ai-vs-ai' 
          ? [ { id: 'ai1', config: ai1, setter: setAi1, title: 'AI 1' }, { id: 'ai2', config: ai2, setter: setAi2, title: 'AI 2' } ]
          : [ { id: 'ai1', config: ai1, setter: setAi1, title: 'AI' } ]
        ).map(({ id, config, title }) => (
          <Col md={debateMode === 'ai-vs-ai' ? 6 : 12} className="mb-4" key={id}>
            <Card>
              <Card.Header as="h5" className="text-center">{title}</Card.Header>
              <Card.Body>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor={`${id}-model`}>モデル</Form.Label>
                  <Form.Select id={`${id}-model`} value={config.model} onChange={e => (id === 'ai1' ? setAi1 : setAi2)(prev => ({...prev, model: e.target.value}))} disabled={!isClient || isLoading || isJudging || models.length === 0 || isLoadingModels}>
                    {isLoadingModels ? (
                      <option value="">モデルを読み込み中...</option>
                    ) : models.length === 0 ? (
                      <option value="">モデルの取得に失敗しました</option>
                    ) : (
                      <>
                        <option value="">モデルを選択してください...</option>
                        {isClient && models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </>
                    )}
                  </Form.Select>
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor={`${id}-personality`}>性格</Form.Label>
                  <Form.Select id={`${id}-personality`} value={config.personality} onChange={e => handlePersonalityChange(id as 'ai1' | 'ai2', e.target.value)} disabled={isLoading || isJudging}>
                    {PERSONALITY_PRESETS.map(p => <option key={p.name} value={p.prompt}>{p.name}</option>)}
                  </Form.Select>
                </Form.Group>
                <Form.Group>
                  <Form.Label htmlFor={`${id}-custom-prompt`}>カスタムプロンプト</Form.Label>
                  <Form.Control id={`${id}-custom-prompt`} as="textarea" rows={3} placeholder={`AI ${id.slice(-1)} のカスタム指示を入力...`} value={config.customPrompt} onChange={e => handleCustomPromptChange(id as 'ai1' | 'ai2', e.target.value)} disabled={isLoading || isJudging || config.personality !== ''} />
                </Form.Group>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <div className="d-grid mb-4">
        <Stack direction="horizontal" gap={3}>
            <Button variant="primary" size="lg" onClick={handleStartDebate} disabled={isLoading || isJudging} className="w-100">
              {isLoading ? <><Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" /> 討論中...</> : '討論を開始'}
            </Button>
            {isLoading && (
                <Button variant="danger" size="lg" onClick={handleStopDebate} className="w-100">
                    討論を停止
                </Button>
            )}
        </Stack>
      </div>

      <Card className="mb-4">
        <Card.Header as="h5">討論ログ</Card.Header>
        <Card.Body ref={chatLogRef} style={{ height: '500px', overflowY: 'auto', background: '#f8f9fa' }}>
          {chatHistory.length === 0 && !isLoading && <p className="text-muted">討論を開始すると、ここに内容が表示されます。</p>}
          {isLoading && chatHistory.length <= 1 && <div className="text-center"><Spinner animation="grow" /> <p>討論を開始しています...</p></div>}
          {chatHistory.map((msg, index) => (
            <div key={index} className={`mb-3 d-flex ${msg.sender === 'AI 1' ? 'justify-content-start' : msg.sender === 'AI 2' ? 'justify-content-end' : msg.sender === 'Player' ? 'justify-content-end' : 'justify-content-center'}`}>
              {msg.sender === 'System' ? (
                <Badge bg="secondary">{msg.parts[0].text}</Badge>
              ) : (
                <Card style={{ width: '80%' }}>
                  <Card.Header as="strong" className={`${msg.sender === 'AI 1' ? 'bg-primary text-white' : msg.sender === 'Player' ? 'bg-warning text-dark' : 'bg-success text-white'} d-flex justify-content-between align-items-center`}>
                    <span>{msg.sender}</span>
                    <div className="d-flex align-items-center">
                      {msg.responseTime != null && (
                          <small className="fw-normal opacity-75 me-2">res: {(msg.responseTime / 1000).toFixed(2)}s</small>
                      )}
                      {msg.retries != null && msg.retries > 0 && (
                          <small className="fw-normal opacity-75">(retry: {msg.retries})</small>
                      )}
                    </div>
                  </Card.Header>
                  <Card.Body style={{ whiteSpace: 'pre-wrap' }}>{msg.parts[0].text}</Card.Body>
                </Card>
              )}
            </div>
          ))}
          {thinkingAI && (
            <div className={`mb-3 d-flex ${thinkingAI === 'AI 1' ? 'justify-content-start' : 'justify-content-end'}`}>
                <Card style={{ width: '80%' }}>
                  <Card.Header as="strong" className={thinkingAI === 'AI 1' ? 'bg-primary text-white' : 'bg-success text-white'}>{thinkingAI}</Card.Header>
                  <Card.Body>
                    <span>考え中{thinkingDots}</span>
                  </Card.Body>
                </Card>
            </div>
          )}
        </Card.Body>
      </Card>

      {debateMode === 'ai-vs-player' && waitingForPlayer && (
        <Card className="mb-4">
          <Card.Header as="h5">あなたのターン</Card.Header>
          <Card.Body>
            <Form onSubmit={(e) => {
              e.preventDefault();
              if (playerMessage.trim()) {
                handlePlayerMessage();
              }
            }}>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="player-message">あなたの意見（150文字程度）</Form.Label>
                <Form.Control 
                  id="player-message"
                  as="textarea" 
                  rows={3} 
                  value={playerMessage} 
                  onChange={e => setPlayerMessage(e.target.value)}
                  placeholder="あなたの意見を入力してください..."
                  disabled={isLoading || isJudging}
                />
              </Form.Group>
              <div className="d-flex gap-2">
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={!playerMessage.trim() || isLoading || isJudging}
                  className="flex-grow-1"
                >
                  送信
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={handleEndPlayerDebate}
                  disabled={isLoading || isJudging}
                >
                  討論終了
                </Button>
              </div>
            </Form>
          </Card.Body>
        </Card>
      )}

      {(isJudging || judgment) && (
        <Card bg="light">
            <Card.Header as="h5">最終判定</Card.Header>
            <Card.Body>
                {isJudging ? (
                    <div className="text-center">
                        <Spinner animation="border" variant="secondary" className="me-2"/>
                        <span>審判AIが判定中です...</span>
                    </div>
                ) : (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{judgment}</div>
                )}
            </Card.Body>
        </Card>
      )}

    </Container>
  );
}