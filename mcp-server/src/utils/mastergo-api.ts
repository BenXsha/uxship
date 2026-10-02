import axios, { AxiosInstance } from 'axios'

const DEFAULT_PORT = 50678
const TIMEOUT_MS = 15000

export interface MastergoApiConfig {
  host?: string
  port?: number
  username?: string
  password?: string
}

export interface ApiResult<T = any> {
  data?: T
  error?: string
}

export class MastergoApi {
  private client: AxiosInstance
  private connected = false

  constructor(config: MastergoApiConfig = {}) {
    const host = config.host || '127.0.0.1'
    const port = config.port || DEFAULT_PORT

    this.client = axios.create({
      baseURL: `http://${host}:${port}/api`,
      timeout: TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      auth: config.username
        ? { username: config.username, password: config.password || '' }
        : undefined,
    })

    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED') {
          this.connected = false
        }
        return Promise.reject(err)
      },
    )
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.client.get('/getUserInfo', { timeout: 3000 })
      this.connected = true
    } catch {
      this.connected = false
    }
    return this.connected
  }

  isConnected(): boolean {
    return this.connected
  }

  // ====== 读取操作 ======

  async getSelectionNode(id?: string): Promise<ApiResult> {
    const params: Record<string, string> = {}
    if (id) params.id = id
    return this.safeGet('/getSelectionNode', { params })
  }

  async getSelectionNodes(ids: string[]): Promise<ApiResult> {
    return this.safeGet('/getSelectionNode', { params: { ids: ids.join(',') } })
  }

  async getCode(id: string): Promise<ApiResult> {
    return this.safeGet(`/getCode/${id}`)
  }

  async getCodeList(): Promise<ApiResult> {
    return this.safeGet('/getCodeList')
  }

  async getComponentInfo(teamLibraryId: string): Promise<ApiResult> {
    return this.safeGet('/getComponentInfo', {
      params: { teamLibraryId, includePropertyDetails: true },
    })
  }

  async getScreenshot(id?: string, ids?: string[]): Promise<ApiResult> {
    const params: Record<string, string> = {}
    if (id) params.id = id
    if (ids?.length) params.ids = ids.join(',')
    return this.safeGet('/getScreenshot', { params })
  }

  async getFonts(): Promise<ApiResult> {
    return this.safeGet('/getFonts')
  }

  async getFrontendCode(params: {
    id?: string
    ids?: string[]
    framework: string
    projectDir?: string
  }): Promise<ApiResult> {
    const query: Record<string, string> = { framework: params.framework }
    if (params.id) query.id = params.id
    if (params.ids?.length) query.ids = params.ids.join(',')
    if (params.projectDir) query.projectDir = params.projectDir
    return this.safeGet('/getFrontendCode', { params: query })
  }

  async getDesignDiff(params: { oldCode: string; newCode: string }): Promise<ApiResult> {
    return this.safePost('/getDesignDiff', params)
  }

  async getUserInfo(): Promise<ApiResult> {
    return this.safeGet('/getUserInfo')
  }

  async getTeamLibraryList(): Promise<ApiResult> {
    return this.safeGet('/getTeamLibraryList')
  }

  async getVariables(): Promise<ApiResult> {
    return this.safeGet('/getVariables')
  }

  // ====== 写入操作 ======

  async createPage(params: {
    name: string
    code?: string
    projectDir?: string
    saveCodeToLocal?: boolean
  }): Promise<ApiResult> {
    return this.safePost('/createPage', params)
  }

  async createComponent(params: {
    name: string
    code: string
    projectDir?: string
  }): Promise<ApiResult> {
    return this.safePost('/createComponent', params)
  }

  async updateNode(nodeId: string, properties: Record<string, any>): Promise<ApiResult> {
    return this.safePost('/updateNode', { nodeId, properties })
  }

  async updateNodeWithCode(params: {
    targetNodeId?: string
    code: string
    projectDir?: string
  }): Promise<ApiResult> {
    return this.safePost('/updateNode', params)
  }

  async removeNode(nodeId?: string): Promise<ApiResult> {
    return this.safePost('/removeNode', { targetNodeId: nodeId })
  }

  async replaceNode(params: {
    targetNodeId?: string
    code: string
    projectDir?: string
  }): Promise<ApiResult> {
    return this.safePost('/replaceNode', params)
  }

  async syncToDesign(params: {
    targetNodeId?: string
    filePath?: string
    code?: string
    userConfirmed: boolean
    userConfirmationText: string
  }): Promise<ApiResult> {
    return this.safePost('/syncToDesign', params)
  }

  async submitPageToCanvas(code: string, projectDir?: string): Promise<ApiResult> {
    return this.safePost('/createPage', { code, projectDir })
  }

  async updateVariables(data: any): Promise<ApiResult> {
    return this.safePost('/updateVariables', data)
  }

  async removeVariable(params: {
    id?: string
    collection?: string
    name?: string
    type?: string
  }): Promise<ApiResult> {
    return this.safePost('/removeVariable', params)
  }

  async startPageGenerating(params: {
    requirement: string
    designSource: string
    projectDir?: string
  }): Promise<ApiResult> {
    return this.safePost('/startPageGenerating', params)
  }

  // ====== 内部方法 ======

  /**
   * 通用 GET 请求（供 BackendAdapter 使用）
   */
  async get(path: string, params?: Record<string, any>): Promise<ApiResult> {
    return this.safeGet(path, { params })
  }

  /**
   * 通用 POST 请求（供 BackendAdapter 使用）
   */
  async post(path: string, data?: any): Promise<ApiResult> {
    return this.safePost(path, data)
  }

  private async safeGet(url: string, config?: any): Promise<ApiResult> {
    try {
      const res = await this.client.get(url, config)
      const body = res.data
      if (body?.error) return { error: body.error }
      return { data: body.data ?? body }
    } catch (err: any) {
      return this.handleError(err)
    }
  }

  private async safePost(url: string, data?: any): Promise<ApiResult> {
    try {
      const res = await this.client.post(url, data)
      const body = res.data
      if (body?.error) return { error: body.error }
      return { data: body.data ?? body }
    } catch (err: any) {
      return this.handleError(err)
    }
  }

  private handleError(err: any): ApiResult {
    if (err.code === 'ECONNREFUSED') {
      this.connected = false
      return { error: 'MasterGo desktop app not running. Please open MasterGo first.' }
    }
    if (err.code === 'ECONNABORTED') {
      return { error: 'Request to MasterGo timed out.' }
    }
    if (err.response) {
      return { error: err.response.data?.error || `HTTP ${err.response.status}: ${err.response.statusText}` }
    }
    return { error: err.message || 'Unknown error' }
  }
}
