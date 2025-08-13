// Type definitions for jsonata 1.7
// Project: https://github.com/jsonata-js/jsonata
// Definitions by: Nick <https://github.com/nick121212> and Michael M. Tiller <https://github.com/xogeny>

import type { FhirStructureNavigator } from "@outburn/structure-navigator";

declare function fumifier(str: string, options?: fumifier.FumifierOptions): Promise<fumifier.Expression> | fumifier.Expression;
declare namespace fumifier {

  interface FumifierOptions {
    recover?: boolean,
    navigator?: FhirStructureNavigator
  }

  interface ExprNode {
    type:
        | "binary"
        | "unary"
        | "function"
        | "partial"
        | "lambda"
        | "condition"
        | "transform"
        | "block"
        | "name"
        | "parent"
        | "string"
        | "number"
        | "value"
        | "wildcard"
        | "descendant"
        | "variable"
        | "regexp"
        | "operator"
        | "error";
    value?: any;
    position?: number;
    arguments?: ExprNode[];
    name?: string;
    procedure?: ExprNode;
    steps?: ExprNode[];
    expressions?: ExprNode[];
    stages?: ExprNode[];
    lhs?: ExprNode | ExprNode[];
    rhs?: ExprNode;
  }

  interface FumifierError extends Error {
    code: string;
    position: number;
    start: number;
    line: number;
    token: string;
  }

  interface Environment {
    bind(name: string | symbol, value: any): void;
    lookup(name: string | symbol): any;
    readonly timestamp: Date;
    readonly async: boolean;
  }

  interface Focus {
    readonly environment: Environment;
    readonly input: any;
  }
  interface Expression {
    evaluate(input: any, bindings?: Record<string, any>): Promise<any>;
    evaluate(input: any, bindings: Record<string, any> | undefined, callback: (err: FumifierError, resp: any) => void): void;
    assign(name: string, value: any): void;
    registerFunction(name: string, implementation: (this: Focus, ...args: any[]) => any, signature?: string): void;
    ast(): ExprNode;
  }
}

export default fumifier;
