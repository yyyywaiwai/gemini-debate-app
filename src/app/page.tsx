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
  sender: 'AI 1' | 'AI 2' | 'System';
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
  const [topic, setTopic] = useState('');
  const [ai1, setAi1] = useState<AIConfig>({ model: '', personality: PERSONALITY_PRESETS[0].prompt, customPrompt: '', finalPrompt: PERSONALITY_PRESETS[0].prompt });
  const [ai2, setAi2] = useState<AIConfig>({ model: '', personality: PERSONALITY_PRESETS[1].prompt, customPrompt: '', finalPrompt: PERSONALITY_PRESETS[1].prompt });

  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingAI, setThinkingAI] = useState<'AI 1' | 'AI 2' | null>(null);
  const [thinkingDots, setThinkingDots] = useState('.');
  const [isJudging, setIsJudging] = useState(false);
  const [judgment, setJudgment] = useState<string | null>(null);
  
  const chatLogRef = useRef<HTMLDivElement>(null);
  const stopDebateRef = useRef(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // コンポーネントマウント時にモデルをフェッチ
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetchWithRetry('/api/models');
        if (!response.ok) throw new Error('モデルの取得に失敗しました');
        const data = await response.json();
        setModels(data.models);
      } catch (err) {
        setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
      }
    };
    fetchModels();
  }, []);

  // チャットログを自動スクロール
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chatHistory, thinkingAI, judgment, isJudging]);

  // 「考え中」のドットアニメーション
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
    setter(prev => ({ ...prev, customPrompt: value, finalPrompt: prev.personality === '' ? value : prev.finalPrompt }));
  };

  const handleStopDebate = () => {
    stopDebateRef.current = true;
  };

  const handleStartDebate = async () => {
    if (!topic || !ai1.model || !ai2.model || !ai1.finalPrompt || !ai2.finalPrompt) {
      setError('議題と、両AIのモデルおよび性格設定をすべて入力してください。');
      return;
    }

    setIsLoading(true);
    setError(null);
    setChatHistory([]);
    setJudgment(null);
    stopDebateRef.current = false;
    
    const initialPrompt = `これから討論を始めます。議題は「${topic}」です。あなたの最初の意見を、日本語で150文字程度にまとめて述べてください。${emotionalConstraint}`;
    setChatHistory([{ sender: 'System', role: 'user', parts: [{ text: `討論議題: ${topic}` }] }]);

    const currentHistory: Message[] = [
        { role: 'user', parts: [{ text: initialPrompt }], sender: 'System' }
    ];

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

        let historyForApi = currentHistory.slice(-HISTORY_WINDOW_SIZE);
        if (historyForApi.length > 0 && historyForApi[0].role === 'model') {
            historyForApi = historyForApi.slice(1);
        }

        const startTime = Date.now();
        const response = await fetchWithRetry('/api/debate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: currentAi.model,
            systemPrompt: currentAi.finalPrompt,
            history: historyForApi.map(({role, parts}) => ({role, parts})),
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
        currentHistory.push({ role: 'user', parts: [{ text: `これに対して、あなたの反論を日本語で150文字程度にまとめて述べてください。${emotionalConstraint}` }], sender: 'System' });

        setChatHistory(prev => [...prev, newMessage]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '討論中に不明なエラーが発生しました。');
    } finally {
      setIsLoading(false);
      setThinkingAI(null);

      if (currentHistory.length > 1) {
        try {
          setIsJudging(true);
          const debateContent = currentHistory.filter(m => m.sender !== 'System').map(m => `${m.sender}: ${m.parts[0].text}`).join('\n\n');
          const judgePrompt = `あなたは公平な審判です。以下のAI同士の討論について、最終的な判定を下してください。\n\n1. まず、AI 1とAI 2のそれぞれの主張の要点を簡潔にまとめてください。\n2. 次に、議論の論理性、説得力、一貫性を評価してください。\n3. 最後に、これらの評価に基づいて、どちらのAIが勝利したかを宣言し、その理由を明確に説明してください。\n\n---\n[討論の履歴]\n${debateContent}\n---\n`

          const response = await fetchWithRetry('/api/debate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gemini-1.5-pro-latest', // Use a powerful model for judgment
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
            <Form.Label htmlFor="debate-topic">討論の議題</Form.Label>
            <Form.Control id="debate-topic" type="text" placeholder="例：人工知能は人類にとって有益か？" value={topic} onChange={e => setTopic(e.target.value)} disabled={isLoading || isJudging} />
          </Form.Group>
        </Card.Body>
      </Card>

      <Row>
        {[ { id: 'ai1', config: ai1, setter: setAi1 }, { id: 'ai2', config: ai2, setter: setAi2 } ].map(({ id, config }) => (
          <Col md={6} className="mb-4" key={id}>
            <Card>
              <Card.Header as="h5" className="text-center text-capitalize">{id.replace('ai', 'AI ')}</Card.Header>
              <Card.Body>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor={`${id}-model`}>モデル</Form.Label>
                  <Form.Select id={`${id}-model`} value={config.model} onChange={e => (id === 'ai1' ? setAi1 : setAi2)(prev => ({...prev, model: e.target.value}))} disabled={!isClient || isLoading || isJudging || models.length === 0}>
                    <option value="">モデルを選択してください...</option>
                    {isClient && models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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
            <div key={index} className={`mb-3 d-flex ${msg.sender === 'AI 1' ? 'justify-content-start' : msg.sender === 'AI 2' ? 'justify-content-end' : 'justify-content-center'}`}>
              {msg.sender === 'System' ? (
                <Badge bg="secondary">{msg.parts[0].text}</Badge>
              ) : (
                <Card style={{ width: '80%' }}>
                  <Card.Header as="strong" className={`${msg.sender === 'AI 1' ? 'bg-primary text-white' : 'bg-success text-white'} d-flex justify-content-between align-items-center`}>
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
