import type * as BabelCore from '@babel/core'

interface IState extends BabelCore.PluginPass {
  apis: Set<string>
  packageName: string
  definition: Record<string, any>
}

const plugin = function (babel: typeof BabelCore): BabelCore.PluginObj<IState> {
  const t = babel.types

  // 这些变量需要在每个 program 里重置
  const invokedApis: Map<string, string> = new Map()
  let taroName: string
  let needDefault: boolean

  let referTaro: any[]

  return {
    name: 'babel-plugin-transform-taro-api',
    pre () {
      const { opts = {} as any } = this
      const { apis = new Set<string>(), packageName = '@tarojs/taro-h5', definition = {} } = opts
      this.definition = { ...definition.apis, ...definition.components }
      this.packageName = packageName
      if (apis.size < 1) {
        Object.keys(definition.apis || {}).forEach(key => apis.add(key))
      }
      this.apis = apis
    },
    visitor: {
      ImportDeclaration (ast) {
        if (ast.node.source.value !== this.packageName) return

        ast.node.specifiers.forEach(node => {
          if (t.isImportDefaultSpecifier(node)) {
            needDefault = true
            taroName = node.local.name
          } else if (t.isImportSpecifier(node)) {
            const { imported } = node
            const propertyName = t.isIdentifier(imported) ? imported.name : imported.value
            if (this.apis.has(propertyName)) { // 记录api名字
              ast.scope.rename(node.local.name)
              invokedApis.set(propertyName, node.local.name)
            } else { // 如果是未实现的api 改成Taro.xxx
              needDefault = true
              const localName = node.local.name
              const binding = ast.scope.getBinding(localName)
              const idn = t.identifier(taroName)
              referTaro.push(idn)
              binding && binding.referencePaths.forEach(reference => {
                reference.replaceWith(
                  t.memberExpression(
                    idn,
                    t.identifier(propertyName)
                  )
                )
              })
            }
          }
        })
      },
      MemberExpression (ast) {
        /* 处理Taro.xxx */
        const isTaro = t.isIdentifier(ast.node.object, { name: taroName })
        const property = ast.node.property
        let propertyName: string | null = null
        let propName = 'name'

        if (!isTaro) return

        // 兼容一下 Taro['xxx']
        if (t.isStringLiteral(property)) {
          propName = 'value'
        }
        propertyName = property[propName]

        if (!propertyName) return

        // 同一api使用多次, 读取变量名
        if (this.apis.has(propertyName)) {
          const parentNode = ast.parent
          const isAssignment = t.isAssignmentExpression(parentNode) && parentNode.left === ast.node

          if (!isAssignment) {
            let identifier: BabelCore.types.Identifier
            if (invokedApis.has(propertyName)) {
              identifier = t.identifier(invokedApis.get(propertyName)!)
            } else {
              const newPropertyName = ast.scope.generateUid(propertyName)
              invokedApis.set(propertyName, newPropertyName)
              /* 未绑定作用域 */
              identifier = t.identifier(newPropertyName)
            }
            ast.replaceWith(identifier)
          }
        } else {
          needDefault = true
        }
      },
      // TODO: 使用 babel 将 canIUse('schema') 转换为 true/false
      // FunctionExpression (ast, state) {},
      Program: {
        enter (ast) {
          needDefault = false
          referTaro = []
          invokedApis.clear()

          taroName = ast.scope.getBinding('Taro')
            ? ast.scope.generateUid('Taro')
            : 'Taro'
        },
        exit (ast) {
          const that = this
          // 防止重复引入
          let isTaroApiImported = false
          referTaro.forEach(node => {
            node.name = taroName
          })

          ast.traverse({
            ImportDeclaration (ast) {
              const isImportingTaroApi = ast.node.source.value === that.packageName
              if (!isImportingTaroApi) return
              if (isTaroApiImported) return ast.remove()
              isTaroApiImported = true
              const namedImports = Array.from(invokedApis.entries()).map(([imported, local]) => t.importSpecifier(t.identifier(local), t.identifier(imported)))
              if (needDefault) {
                const defaultImport = t.importDefaultSpecifier(t.identifier(taroName))
                ast.node.specifiers = [
                  defaultImport,
                  ...namedImports
                ]
                needDefault = false
              } else {
                ast.node.specifiers = namedImports
              }
            }
          })
        }
      }
    }
  }
}

export default plugin
