import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

describe('Pre-cached Golden Sample Artifacts', () => {
  const samplesDir = path.resolve(process.cwd(), 'public/samples');

  it('generates and validates all featured samples (FastAPI, Express, PyTorch, Twitter Sentiment)', async () => {
    if (!fs.existsSync(samplesDir)) {
      fs.mkdirSync(samplesDir, { recursive: true });
    }

    // 1. FastAPI Sample
    const fastapiFiles: DiscoveredFile[] = [
      {
        path: 'pyproject.toml',
        size: 250,
        hash: 'fa_p1',
        content: `[project]\nname = "fastapi"\nversion = "0.115.0"\ndependencies = ["starlette", "pydantic", "typing-extensions"]\n`,
      },
      {
        path: 'requirements.txt',
        size: 80,
        hash: 'fa_p2',
        content: 'fastapi>=0.115.0\npydantic>=2.0\nuvicorn>=0.30.0\nsqlalchemy>=2.0\npytest>=8.0\n',
      },
      {
        path: 'fastapi/applications.py',
        size: 1500,
        hash: 'fa_1',
        content: `
from fastapi.routing import APIRouter
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

class FastAPI:
    def __init__(self, title: str = "FastAPI"):
        self.router = APIRouter()
    
    def include_router(self, router: APIRouter, prefix: str = ""):
        pass
    
    def add_middleware(self, middleware_class, **options):
        pass

    def get(self, path: str):
        def decorator(func):
            return func
        return decorator

    def post(self, path: str):
        def decorator(func):
            return func
        return decorator
`,
      },
      {
        path: 'fastapi/routing.py',
        size: 1200,
        hash: 'fa_2',
        content: `
from fastapi.params import Depends

class APIRouter:
    def __init__(self, prefix: str = "", tags: list = None):
        self.prefix = prefix
        self.routes = []

    def get(self, path: str, response_model=None):
        def decorator(func):
            return func
        return decorator

    def post(self, path: str, status_code: int = 200):
        def decorator(func):
            return func
        return decorator

    def delete(self, path: str):
        def decorator(func):
            return func
        return decorator
`,
      },
      {
        path: 'fastapi/params.py',
        size: 800,
        hash: 'fa_3',
        content: `
class Param:
    def __init__(self, default=None):
        self.default = default

class Query(Param): pass
class Header(Param): pass
class Body(Param): pass
class Depends:
    def __init__(self, dependency=None):
        self.dependency = dependency
`,
      },
      {
        path: 'fastapi/encoders.py',
        size: 600,
        hash: 'fa_4',
        content: `
from pydantic import BaseModel

def jsonable_encoder(obj):
    if isinstance(obj, BaseModel):
        return obj.dict()
    return obj
`,
      },
      {
        path: 'app/api/v1/endpoints/items.py',
        size: 700,
        hash: 'fa_5',
        content: `
from fastapi import APIRouter, Depends
from app.models.item import Item
from app.services.items import ItemService

router = APIRouter(prefix="/items", tags=["items"])

@router.get("/")
def read_items(service: ItemService = Depends()):
    return service.get_all()

@router.post("/", status_code=201)
def create_item(item: Item, service: ItemService = Depends()):
    return service.create(item)
`,
      },
      {
        path: 'app/models/item.py',
        size: 500,
        hash: 'fa_6',
        content: `
from pydantic import BaseModel
from typing import Optional

class Item(BaseModel):
    id: Optional[int] = None
    title: str
    description: Optional[str] = None
    price: float
`,
      },
      {
        path: 'app/services/items.py',
        size: 600,
        hash: 'fa_7',
        content: `
from app.models.item import Item

class ItemService:
    def get_all(self):
        return []

    def create(self, item: Item):
        return item
`,
      },
    ];

    // 2. Express Sample
    const expressFiles: DiscoveredFile[] = [
      {
        path: 'package.json',
        size: 400,
        hash: 'ex_p1',
        content: JSON.stringify({
          name: 'express',
          version: '4.21.0',
          description: 'Fast, unopinionated, minimalist web framework for node.',
          dependencies: {
            accepts: '~1.3.8',
            'body-parser': '1.20.3',
            cookie: '0.7.1',
            debug: '2.6.9',
            'http-errors': '2.0.0',
            methods: '~1.1.2',
            qs: '6.13.0',
            send: '0.19.0',
          },
        }),
      },
      {
        path: 'lib/express.js',
        size: 1100,
        hash: 'ex_1',
        content: `
const proto = require('./application');
const Route = require('./router/route');
const Router = require('./router');
const req = require('./request');
const res = require('./response');

function createApplication() {
  const app = function(req, res, next) {
    app.handle(req, res, next);
  };
  return Object.assign(app, proto);
}

exports = module.exports = createApplication;
exports.Router = Router;
exports.Route = Route;
`,
      },
      {
        path: 'lib/application.js',
        size: 1800,
        hash: 'ex_2',
        content: `
const Router = require('./router');

const app = exports = module.exports = {};

app.init = function init() {
  this.settings = {};
  this._router = new Router();
};

app.use = function use(fn) {
  this._router.use(fn);
  return this;
};

app.get = function get(path, handler) {
  this._router.get(path, handler);
  return this;
};

app.post = function post(path, handler) {
  this._router.post(path, handler);
  return this;
};
`,
      },
      {
        path: 'lib/router/index.js',
        size: 1400,
        hash: 'ex_3',
        content: `
const Route = require('./route');
const Layer = require('./layer');

function Router(options) {
  this.params = {};
  this.stack = [];
}

Router.prototype.use = function use(path, fn) {
  const layer = new Layer(path, fn);
  this.stack.push(layer);
};

module.exports = Router;
`,
      },
      {
        path: 'lib/request.js',
        size: 900,
        hash: 'ex_4',
        content: `
const req = exports = module.exports = {
  get(header) {
    return this.headers[header.toLowerCase()];
  },
  param(name, defaultValue) {
    return this.params[name] || this.query[name] || defaultValue;
  }
};
`,
      },
      {
        path: 'lib/response.js',
        size: 1200,
        hash: 'ex_5',
        content: `
const res = exports = module.exports = {
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(body));
  }
};
`,
      },
    ];

    // 3. PyTorch Sample
    const pytorchFiles: DiscoveredFile[] = [
      {
        path: 'pyproject.toml',
        size: 300,
        hash: 'pt_p1',
        content: `[project]\nname = "torch"\nversion = "2.5.0"\ndescription = "Tensors and Dynamic neural networks in Python with strong GPU acceleration"\n`,
      },
      {
        path: 'torch/__init__.py',
        size: 1500,
        hash: 'pt_1',
        content: `
import torch.nn as nn
import torch.autograd as autograd
import torch.optim as optim
import torch.cuda as cuda
from torch.tensor import Tensor

__version__ = "2.5.0"

def zeros(*size, dtype=None):
    return Tensor(*size)

def ones(*size, dtype=None):
    return Tensor(*size)
`,
      },
      {
        path: 'torch/tensor.py',
        size: 1100,
        hash: 'pt_2',
        content: `
class Tensor:
    def __init__(self, *shape):
        self.shape = shape
        self.grad = None
        self.requires_grad = False

    def backward(self, gradient=None):
        pass

    def to(self, device):
        return self

    def cuda(self):
        return self

    def cpu(self):
        return self
`,
      },
      {
        path: 'torch/nn/modules/module.py',
        size: 1600,
        hash: 'pt_3',
        content: `
from torch.tensor import Tensor

class Module:
    def __init__(self):
        self._parameters = {}
        self._modules = {}
        self.training = True

    def forward(self, *input):
        raise NotImplementedError

    def __call__(self, *input):
        return self.forward(*input)

    def parameters(self):
        return list(self._parameters.values())

    def train(self, mode: bool = True):
        self.training = mode
        return self

    def eval(self):
        return self.train(False)
`,
      },
      {
        path: 'torch/nn/modules/linear.py',
        size: 800,
        hash: 'pt_4',
        content: `
from torch.nn.modules.module import Module
from torch.tensor import Tensor

class Linear(Module):
    def __init__(self, in_features: int, out_features: int, bias: bool = True):
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features
        self.weight = Tensor(out_features, in_features)

    def forward(self, input: Tensor) -> Tensor:
        return input
`,
      },
      {
        path: 'torch/nn/modules/conv.py',
        size: 900,
        hash: 'pt_5',
        content: `
from torch.nn.modules.module import Module
from torch.tensor import Tensor

class Conv2d(Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int):
        super().__init__()
        self.in_channels = in_channels
        self.out_channels = out_channels
        self.kernel_size = kernel_size

    def forward(self, input: Tensor) -> Tensor:
        return input
`,
      },
      {
        path: 'torch/optim/adam.py',
        size: 700,
        hash: 'pt_6',
        content: `
class Adam:
    def __init__(self, params, lr: float = 1e-3, betas=(0.9, 0.999)):
        self.params = list(params)
        self.lr = lr

    def step(self):
        pass

    def zero_grad(self):
        for p in self.params:
            p.grad = None
`,
      },
      {
        path: 'torch/autograd/engine.py',
        size: 850,
        hash: 'pt_7',
        content: `
class ExecutionEngine:
    def run_backward(self, tensors, grad_tensors):
        pass
`,
      },
    ];

    // 4. Twitter Sentiment Sample
    const twitterFiles: DiscoveredFile[] = [
      {
        path: 'requirements.txt',
        size: 150,
        hash: 'tw_p1',
        content: 'Flask==2.3.2\nscikit-learn==1.3.0\nnltk==3.8.1\npandas==2.0.3\nnumpy==1.24.3\ngunicorn==20.1.0\n',
      },
      {
        path: 'app.py',
        size: 1200,
        hash: 'tw_1',
        content: `
from flask import Flask, render_template, request, jsonify
from model.predictor import SentimentPredictor
from utils.preprocessor import clean_tweet

app = Flask(__name__)
predictor = SentimentPredictor()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()
    tweet = data.get('tweet', '')
    cleaned = clean_tweet(tweet)
    prediction, confidence = predictor.predict(cleaned)
    return jsonify({'sentiment': prediction, 'confidence': confidence})

if __name__ == '__main__':
    app.run(debug=True)
`,
      },
      {
        path: 'model/predictor.py',
        size: 800,
        hash: 'tw_2',
        content: `
class SentimentPredictor:
    def __init__(self, model_path='model/model.pkl'):
        self.model_path = model_path
        self.model = None

    def predict(self, text: str):
        return 'Positive', 0.92
`,
      },
      {
        path: 'utils/preprocessor.py',
        size: 600,
        hash: 'tw_3',
        content: `
import re

def clean_tweet(tweet: str) -> str:
    tweet = re.sub(r'http\\S+|www\\S+|https\\S+', '', tweet, flags=re.MULTILINE)
    tweet = re.sub(r'\\@\\w+|\\#', '', tweet)
    return tweet.lower().strip()
`,
      },
    ];

    const fastapiProject = await analyzeRepositoryFiles(
      { name: 'fastapi', source: 'https://github.com/fastapi/fastapi', files: fastapiFiles, skipped: [] },
      {}
    );
    fs.writeFileSync(path.join(samplesDir, 'fastapi.json'), JSON.stringify(fastapiProject, null, 2));

    const expressProject = await analyzeRepositoryFiles(
      { name: 'express', source: 'https://github.com/expressjs/express', files: expressFiles, skipped: [] },
      {}
    );
    fs.writeFileSync(path.join(samplesDir, 'express.json'), JSON.stringify(expressProject, null, 2));

    const pytorchProject = await analyzeRepositoryFiles(
      { name: 'pytorch', source: 'https://github.com/pytorch/pytorch', files: pytorchFiles, skipped: [] },
      {}
    );
    fs.writeFileSync(path.join(samplesDir, 'pytorch.json'), JSON.stringify(pytorchProject, null, 2));

    const twitterProject = await analyzeRepositoryFiles(
      { name: 'Twitter-Sentiment-Analysis', source: 'https://github.com/yusrababari/Twitter-Sentiment-Analysis', files: twitterFiles, skipped: [] },
      {}
    );
    fs.writeFileSync(path.join(samplesDir, 'twitter-sentiment.json'), JSON.stringify(twitterProject, null, 2));

    // Verify all generated sample artifacts
    expect(fastapiProject.repository.name).toBe('fastapi');
    expect(fastapiProject.architecture.components.length).toBeGreaterThan(0);
    expect(fastapiProject.routes.length).toBeGreaterThan(0);

    expect(expressProject.repository.name).toBe('express');
    expect(expressProject.architecture.components.length).toBeGreaterThan(0);

    expect(pytorchProject.repository.name).toBe('pytorch');
    expect(pytorchProject.symbols.length).toBeGreaterThan(0);

    expect(twitterProject.repository.name).toBe('Twitter-Sentiment-Analysis');
    expect(twitterProject.routes.length).toBeGreaterThan(0);
  });
});
