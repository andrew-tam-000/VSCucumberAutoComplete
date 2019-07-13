import {
    getOSPath,
    getFileContent,
    clearComments,
    getMD5Id,
    escapeRegExp,
    getTextRange,
    getSortPrefix
} from './util';

import {
    allGherkinWords,
    GherkinType,
    getGherkinType,
    getGherkinTypeLower
} from './gherkin';

import {
    Definition,
    CompletionItem,
    Diagnostic,
    DiagnosticSeverity,
    Position,
    Location,
    Range,
    CompletionItemKind,
    InsertTextFormat,
} from 'vscode-languageserver';

import * as glob from 'glob';

export type Step = {
    id: string,
    originalText: string,
    reg: RegExp,
    partialReg: RegExp,
    text: string,
    desc: string,
    def: Definition,
    count: number,
    gherkin: GherkinType,
    documentation: any,
};

export type StepsCountHash = {
    [step: string]: number
};

interface JSDocComments {
    [key: number]: string
}

const commentParser = require('doctrine');

const customParamRegExp = new RegExp(/([^\\]|^){(?![\d,])(.*?)}/g);

export default class StepsHandler {

    elements: Step[];

    elementsHash: { [step: string]: boolean } = {};

    elemenstCountHash: StepsCountHash = {};

    settings: Settings;

    customParameterMap: { [customParam: string]: CustomParameter }

    stepWithoutCustomParameterMap: {[key:string]:string}

    constructor(root: string, settings: Settings) {
        const { steps, syncfeatures } = settings.cucumberautocomplete;
        this.settings = settings;
        this.customParameterMap = this.getCustomParameterMap();
        this.populate(root, steps);
        if (syncfeatures === true) {
            this.setElementsHash(`${root}/**/*.feature`);
        } else if (typeof syncfeatures === 'string') {
            this.setElementsHash(`${root}/${syncfeatures}`);
        }
    }

    // Get all the custom parameters and index them
    getCustomParameterMap() : {[key: string]:CustomParameter} {
        return this.settings.cucumberautocomplete.customParameters.reduce((acc, customParameterConfig) => {
            acc[customParameterConfig.parameter.toString()] = customParameterConfig
            return acc;
        }, {});
    }

    getGherkinRegEx() {
        return new RegExp(`^(\\s*)(${allGherkinWords})(\\s+)(.*)`);
    }

    getElements(): Step[] {
        return this.elements;
    }

    setElementsHash(path: string): void {
        this.elemenstCountHash = {};
        const files = glob.sync(path, { ignore: '.gitignore' });
        files.forEach(f => {
            const text = getFileContent(f);
            text.split(/\r?\n/g).forEach(line => {
                const match = this.getGherkinMatch(line, text);
                if (match) {
                    const step = this.getStepByText(match[4]);
                    if (step) {
                        this.incrementElementCount(step.id);
                    }
                }
            });
        });
        this.elements.forEach(el => el.count = this.getElementCount(el.id));
    }

    incrementElementCount(id: string): void {
        if (this.elemenstCountHash[id]) {
            this.elemenstCountHash[id]++;
        } else {
            this.elemenstCountHash[id] = 1;
        }
    }

    getElementCount(id: string): number {
        return this.elemenstCountHash[id] || 0;
    }

    getStepRegExp(): RegExp {

        //Actually, we dont care what the symbols are before our 'Gherkin' word
        //But they shouldn't end with letter
        const startPart = '^((?:[^\'"\/]*?[^\\w])|.{0})';

        //All the steps should be declared using any gherkin keyword. We should get first 'gherkin' word
        const gherkinPart = this.settings.cucumberautocomplete.gherkinDefinitionPart || `(${allGherkinWords}|defineStep|Step|StepDefinition)`;

        //All the symbols, except of symbols, using as step start and letters, could be between gherkin word and our step
        const nonStepStartSymbols = `[^\/'"\`\\w]*?`;

        // Step part getting
        const { stepRegExSymbol } = this.settings.cucumberautocomplete;
        //Step text could be placed between '/' symbols (ex. in JS) or between quotes, like in Java
        const stepStart = stepRegExSymbol ? `(${stepRegExSymbol})` : `(\/|'|"|\`)`;
        //Our step could contain any symbols, except of our 'stepStart'. Use \3 to be sure in this
        const stepBody = stepRegExSymbol ? `([^${stepRegExSymbol}]+)` : '([^\\3]+)';
        //Step should be ended with same symbol it begins
        const stepEnd = stepRegExSymbol ? stepRegExSymbol : '\\3';

        //Our RegExp will be case-insensitive to support cases like TypeScript (...@when...)
        const r = new RegExp(startPart + gherkinPart + nonStepStartSymbols + stepStart + stepBody + stepEnd, 'i');

        // /^((?:[^'"\/]*?[^\w])|.{0})(Given|When|Then|And|But|defineStep)[^\/'"\w]*?(\/|'|")([^\3]+)\3/i
        return r;

    }

    geStepDefinitionMatch(line: string): RegExpMatchArray {
        return line.match(this.getStepRegExp());
    }

    getOutlineVars(text: string) {
        return text.split(/\r?\n/g).reduce((res, a, i, arr) => {
            if (a.match(/^\s*Examples:\s*$/) && arr[i + 2]) {
                const names = arr[i + 1].split(/\s*\|\s*/).slice(1, -1);
                const values = arr[i + 2].split(/\s*\|\s*/).slice(1, -1);
                names.forEach((n, i) => {
                    if (values[i]) {
                        res[n] = values[i];
                    }
                });
            }
            return res;
        }, {});
    }

    getGherkinMatch(line: string, document: string): RegExpMatchArray {
        const outlineMatch = line.match(/<.*?>/g);
        if (outlineMatch) {
            const outlineVars = this.getOutlineVars(document);
            //We should support both outlines lines variants - with and without quotes
            const pureLine = outlineMatch.map(s => s.replace(/<|>/g, '')).reduce((resLine, key) => {
                if (outlineVars[key]) {
                    resLine = resLine.replace(`<${key}>`, outlineVars[key]);
                }
                return resLine;
            }, line);
            const quotesLine = outlineMatch.map(s => s.replace(/<|>/g, '')).reduce((resLine, key) => {
                if (outlineVars[key]) {
                    resLine = resLine.replace(`<${key}>`, `"${outlineVars[key]}"`);
                }
                return resLine;
            }, line);
            const pureMatch = pureLine.match(this.getGherkinRegEx());
            const quotesMatch = quotesLine.match(this.getGherkinRegEx());
            if (quotesMatch && quotesMatch[4] && this.getStepByText(quotesMatch[4])) {
                return quotesMatch;
            } else {
                return pureMatch;
            }
        }
        return line.match(this.getGherkinRegEx());
    }

    handleCustomParameters(step: string): string {
        if (!step) return '';
        this.settings.cucumberautocomplete.customParameters.forEach((p: CustomParameter) => {
            const { parameter, value } = p;
            step = step.split(parameter).join(value);
        });
        return step;
    }

    getRegTextForStep(step: string): string {

        //Ruby interpolation (like `#{Something}` ) should be replaced with `.*`
        //https://github.com/alexkrechik/VSCucumberAutoComplete/issues/65
        step = step.replace(/#{(.*?)}/g, '.*');

        //Parameter-types
        //https://github.com/alexkrechik/VSCucumberAutoComplete/issues/66
        //https://docs.cucumber.io/cucumber/cucumber-expressions/
        step = step.replace(/{float}/g, '-?\\d*\\.?\\d+');
        step = step.replace(/{int}/g, '-?\\d+');
        step = step.replace(/{stringInDoubleQuotes}/g, '"[^"]+"');
        step = step.replace(/{string}/g, '"[^"]+"');
        step = step.replace(/{}/g, '.*');

        //Optional Text
        step = step.replace(/\(([a-z]+)\)/g, '($1)?');

        //Alternative text a/b/c === (a|b|c)
        step = step.replace(/([a-zA-Z]+)(?:\/([a-zA-Z]+))+/g, match => `(${match.replace(/\//g, '|')})`);

        //Handle Cucumber Expressions (like `{Something}`) should be replaced with `.*`
        //https://github.com/alexkrechik/VSCucumberAutoComplete/issues/99
        //Cucumber Expressions Custom Parameter Type Documentation
        //https://docs.cucumber.io/cucumber-expressions/#custom-parameters
        step = step.replace(customParamRegExp, '$1.*');

        //Escape all the regex symbols to avoid errors
        step = escapeRegExp(step);

        return step;
    }

    getPartialRegParts(text: string): string[] {
        // We should separate got string into the parts by space symbol
        // But we should not touch /()/ RegEx elements
        text = this.getRegTextForStep(text);
        let currString = '';
        let bracesMode = false;
        let openingBracesNum;
        let closingBracesNum;
        const res = [];
        for (let i = 0; i <= text.length; i++) {
            const currSymbol = text[i];
            if (i === text.length) {
                res.push(currString);
            } else if (bracesMode) {
                //We should do this hard check to avoid circular braces errors
                if (currSymbol === ')') {
                    closingBracesNum++;
                    if (openingBracesNum === closingBracesNum) {
                        bracesMode = false;
                    }
                }
                if (currSymbol === '(') {
                    openingBracesNum++;
                }
                currString += currSymbol;
            } else {
                if (currSymbol === ' ') {
                    res.push(currString);
                    currString = '';
                } else if (currSymbol === '(') {
                    currString += '(';
                    bracesMode = true;
                    openingBracesNum = 1;
                    closingBracesNum = 0;
                } else {
                    currString += currSymbol;
                }
            }
        }
        return res;
    }

    getPartialRegText(regText: string): string {
        //Same with main reg, only differ is match any string that same or less that current one
        return this.getPartialRegParts(regText)
            .map(el => `(${el}|$)`)
            .join('( |$)')
            .replace(/^\^|^/, '^');
    }

    getTextForStep(step: string): string {

        //Remove all the backslashes
        step = step.replace(/\\/g, '');

        //Remove "string start" and "string end" RegEx symbols
        step = step.replace(/^\^|\$$/g, '');

        return step;
    }

    getDescForStep(step: string): string {

        //Remove 'Function body' part
        step = step.replace(/\{.*/, '');

        //Remove spaces in the beginning end in the end of string
        step = step.replace(/^\s*/, '').replace(/\s*$/, '');

        return step;
    }

    getStepTextInvariants(step: string): string[] {
        //Handle regexp's like 'I do (one|to|three)'
        //TODO - generate correct num of invariants for the circular braces
        const bracesRegEx = /(\([^\)\()]+\|[^\(\)]+\))/;
        if (~step.search(bracesRegEx)) {
            const match = step.match(bracesRegEx);
            const matchRes = match[1];
            const variants = matchRes.replace(/\(\?\:/, '').replace(/^\(|\)$/g, '').split('|');
            return variants.reduce((varRes, variant) => {
                return varRes.concat(this.getStepTextInvariants(step.replace(matchRes, variant)));
            }, []);
        } else {
            return [step];
        }
    }

    getCompletionInsertText(step: string, stepPart: string): string {

        // Return only part we need for our step
        let res = step;
        const strArray = this.getPartialRegParts(res);
        const currArray = [];
        const { length } = strArray;
        for (let i = 0; i < length; i++) {
            currArray.push(strArray.shift());
            try {
                // Need to handle edge case of leading ^.*
                const r = new RegExp('^' + escapeRegExp(currArray.join(' ')));
                if (!r.test(stepPart) || i === 0 && currArray[i] === '.*') {
                    res = [].concat(currArray.slice(-1), strArray).join(' ');
                    break;
                }
            } catch (err) {
                //TODO - show some warning
            }
        }

        if (this.settings.cucumberautocomplete.smartSnippets) {
            /*
                Now we should change all the 'user input' items to some snippets
                Create our regexp for this:
                1) \(? - we be started from opening brace
                2) \\.|\[\[^\]]\] - [a-z] or \w or .
                3) \*|\+|\{[^\}]+\} - * or + or {1, 2}
                4) \)? - could be finished with opening brace
            */

            const match = res.match(/((?:\()?(?:\\.|\.|\[[^\]]+\])(?:\*|\+|\{[^\}]+\})(?:\)?))/g);
            if (match) {
                const orderedCustomParamsInStep = (step.match(customParamRegExp) || []).map(str => str.trim());
                for (let i = 0; i < match.length; i++) {
                    const num = i + 1;
                    if (this.settings.cucumberautocomplete.customParametersAutocomplete) {
                        // If we are doing autocomplete, it means that all the customParamsw ill be expanded
                        //
                        // For the simplest case, each custom param will match up exactly with an index
                        const customParameterConfig = this.customParameterMap[orderedCustomParamsInStep[i]];
                        const autocompleteOptions = (customParameterConfig && customParameterConfig.autocomplete ? customParameterConfig.autocomplete : []).join(',');
                        const snippet = `${this.settings.cucumberautocomplete.wrapSnippetsInCharacter}\${${num}|${autocompleteOptions}|}${this.settings.cucumberautocomplete.wrapSnippetsInCharacter}`;
                        res = res.replace(match[i], () => snippet);
                    }
                    else {
                        res = res.replace(match[i], () => '${' + num + ':}');
                    }
                }
            }

        } else {
            //We can replace some outputs, ex. strings in brackets to make insert strings more neat
            res = res.replace(/\"\[\^\"\]\+\"/g, '""');
        }

        return res;
    }

    getDocumentation(stepRawComment: string) {
        const stepParsedComment = commentParser.parse(stepRawComment.trim(), {unwrap: true, sloppy: true, recoverable: true});
        return stepParsedComment.description ||
        (stepParsedComment.tags.find(tag => tag.title === 'description') || {}).description ||
        (stepParsedComment.tags.find(tag => tag.title === 'desc') || {}).description ||
        stepRawComment;
    }

    getUniqueCustomParametersFromStep(step: string) : string[] {
        const customParametersHash = (step.match(customParamRegExp)||[]).reduce(
            (agg, param) => {
                agg[param.trim()] = true;
                return agg;
            },
            {}
        )
        return Object.keys(customParametersHash).sort();
    }

    getSteps(fullStepLine: string, stepPart: string, def: Location, gherkin: GherkinType, comments: JSDocComments, originalStepPart: string): Step[] {
        const stepsVariants = this.settings.cucumberautocomplete.stepsInvariants ?
            this.getStepTextInvariants(stepPart) : [stepPart];
        const stepsVariantsForOriginalStep = this.settings.cucumberautocomplete.stepsInvariants ?
            this.getStepTextInvariants(stepPart) : [stepPart];
        const desc = this.getDescForStep(fullStepLine);
        const comment = comments[def.range.start.line];
        const documentation = comment ? this.getDocumentation(comment) : originalStepPart;
        return stepsVariants
            .filter((step) => {
                //Filter invalid long regular expressions
                try {
                    new RegExp(this.getRegTextForStep(step));
                    return true;
                } catch (err) {
                    //Todo - show some warning
                    return false;
                }
            })
            .map((step) => {
                const reg = new RegExp(this.getRegTextForStep(step));
                let partialReg;
                // Use long regular expression in case of error
                try {
                    partialReg = new RegExp(this.getPartialRegText(step));
                } catch (err) {
                    // Todo - show some warning
                    partialReg = reg;
                }
                //Todo we should store full value here
                const text = this.getTextForStep(step);
                const originalText = this.getTextForStep(originalStepPart);
                const id = 'step' + getMD5Id(text);
                const count = this.getElementCount(id);
                const customParameterDocumentation = this.getUniqueCustomParametersFromStep(originalText).map(
                    parameter => {
                        const customParameter = this.customParameterMap[parameter];
                        if (customParameter && customParameter.documentation) {
                            return {
                                parameter: customParameter.parameter,
                                documentation: customParameter.documentation
                            }
                        }
                        else {
                            return null;
                        }
                    }
                ).filter(str => str);

                return { id, reg, partialReg, text, desc, def, count, gherkin, documentation: {
                    kind: 'plaintext',
                    value: [
                        'Step Definition\n',
                        documentation,
                        '\n\n',
                        ...(customParameterDocumentation.length ? [
                            'Custom Parameters\n',
                            ...customParameterDocumentation.map(
                                ({parameter, documentation}) => `${parameter}: ${documentation}\n`
                            ),
                            '\n'
                        ] : []
                        ),
                    ].join('\n')
                }, originalText};
            });
    }

    getMultiLineComments(content: string): JSDocComments {
        return content.split(/\r?\n/g).reduce((res, line, i) => {
            if (!!~line.search(/^\s*\/\*/)) {
                res.current = `${line}\n`;
                res.commentMode = true;
            } else if (!!~line.search(/^\s*\*\//)) {
                res.current += `${line}\n`;
                res.comments[i + 1] = res.current;
                res.commentMode = false;
            } else if (res.commentMode) {
                res.current += `${line}\n`;
            }
            return res;
        }, {
            comments: {}, current: '', commentMode: false
        }).comments;
    }

    getFileSteps(filePath: string): Step[] {
        const fileContent = getFileContent(filePath);
        const fileComments = this.getMultiLineComments(fileContent);
        const definitionFile = clearComments(fileContent);
        return definitionFile.split(/\r?\n/g).reduce((steps, line, lineIndex, lines) => {
            //TODO optimize
            let match;
            let finalLine;
            let finalLineWithoutCustomParameters;

            const currLineWithoutCustomParameters = line;
            const currentMatchWithoutCustomParameters = this.geStepDefinitionMatch(line);
            const nextLineWithoutCustomParameters = lines[lineIndex + 1];

            const currLine = this.handleCustomParameters(line);
            const currentMatch = this.geStepDefinitionMatch(currLine);

            //Add next line to our string to handle two-lines step definitions
            const nextLine = this.handleCustomParameters(lines[lineIndex + 1]);
            if (currentMatch) {
                match = currentMatch;
                finalLine = currLine;
                finalLineWithoutCustomParameters = currLineWithoutCustomParameters;

            } else if (nextLine) {
                const nextLineMatch = this.geStepDefinitionMatch(nextLine);
                const bothLinesMatch = this.geStepDefinitionMatch(currLine + nextLine);
                if ( bothLinesMatch && !nextLineMatch) {
                    match = bothLinesMatch;
                    finalLine = currLine + nextLine;
                    finalLineWithoutCustomParameters = currLineWithoutCustomParameters + nextLineWithoutCustomParameters;
                }
            }
            if (match) {
                const [, beforeGherkin, gherkinString, , stepPart] = match;
                const [, , , , originalStepPart] = this.geStepDefinitionMatch(finalLineWithoutCustomParameters);
                const gherkin = getGherkinTypeLower(gherkinString);
                const pos = Position.create(lineIndex, beforeGherkin.length);
                const def = Location.create(getOSPath(filePath), Range.create(pos, pos));
                steps = steps.concat(this.getSteps(finalLine, stepPart, def, gherkin, fileComments, originalStepPart));
            }
            return steps;
        }, []);
    }

    validateConfiguration(settingsFile: string, stepsPathes: StepSettings, workSpaceRoot: string): Diagnostic[] {
        return stepsPathes.reduce((res, path) => {
            const files = glob.sync(path, { ignore: '.gitignore' });
            if (!files.length) {
                const searchTerm = path.replace(workSpaceRoot + '/', '');
                const range = getTextRange(workSpaceRoot + '/' + settingsFile, `"${searchTerm}"`);
                res.push({
                    severity: DiagnosticSeverity.Warning,
                    range: range,
                    message: `No steps files found`,
                    source: 'cucumberautocomplete'
                });
            }
            return res;
        }, []);
    }

    // We need to store the original step defintiion into elements as well

    populate(root: string, stepsPathes: StepSettings): void {
        this.elementsHash = {};
        this.elements = stepsPathes
            .reduce((files, path) => files.concat(glob.sync(root + '/' + path, { ignore: '.gitignore' })), [])
            .reduce((elements, f) => elements.concat(
                this.getFileSteps(f).reduce((steps, step) => {
                    if (!this.elementsHash[step.id]) {
                        steps.push(step);
                        this.elementsHash[step.id] = true;
                    }
                    return steps;
                }, [])
            ), []);
    }

    getStepByText(text: string, gherkin?: GherkinType): Step {
        return this.elements
            .find(s => (gherkin !== undefined ? s.gherkin === gherkin : true) && s.reg.test(text));
    }

    validate(line: string, lineNum: number, text: string): Diagnostic | null {
        line = line.replace(/\s*$/, '');
        const lineForError = line.replace(/^\s*/, '');
        const match = this.getGherkinMatch(line, text);
        if (!match) {
            return null;
        }
        const beforeGherkin = match[1];
        const gherkinPart = match[2];
        const step = this.getStepByText(match[4], this.settings.cucumberautocomplete.strictGherkinValidation
            ? this.getStrictGherkinType(gherkinPart, lineNum, text)
            : undefined
        );
        if (step) {
            return null;
        } else {
            return {
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: { line: lineNum, character: beforeGherkin.length },
                    end: { line: lineNum, character: line.length }
                },
                message: `Was unable to find step for "${lineForError}"`,
                source: 'cucumberautocomplete'
            };
        }
    }

    getDefinition(line: string, text: string): Definition | null {
        const match = this.getGherkinMatch(line, text);
        if (!match) {
            return null;
        }
        const step = this.getStepByText(match[4]);
        return step ? step.def : null;
    }

    getStrictGherkinType(gherkinPart: string, lineNumber: number, text: string) {
        const gherkinType = getGherkinType(gherkinPart);
        if (gherkinType === GherkinType.And || gherkinType === GherkinType.But) {
            return text
                .split(/\r?\n/g)
                .slice(0, lineNumber)
                .reduceRight((res, val) => {
                    if (res === GherkinType.Other) {
                        const match = this.getGherkinMatch(val, text);
                        if (match) {
                            const [, , prevGherkinPart] = match;
                            const prevGherkinPartType = getGherkinTypeLower(prevGherkinPart);
                            if (~[GherkinType.Given, GherkinType.When, GherkinType.Then].indexOf(prevGherkinPartType)) {
                                res = prevGherkinPartType;
                            }
                        }
                    }
                    return res;
                }, GherkinType.Other);
        } else {
            return getGherkinTypeLower(gherkinPart);
        }
    }

    isCustomParameterHighlighted(line: string, character: number, text: string): string|null {
        // If the current string matches anything in array, we are highlighhting a custom parameter
        //
        const nearestPreviousOpeningBracket = line.lastIndexOf('{', character);
        const nearestNextClosingBracket = line.indexOf('}', character);

        // If we are inbetween some brackets, let's check the text
        if (nearestPreviousOpeningBracket > -1 && nearestNextClosingBracket  > -1 && nearestNextClosingBracket  > nearestPreviousOpeningBracket) {
            const phraseInBrackets = line.slice(nearestPreviousOpeningBracket, nearestNextClosingBracket + 1);
            // Now, only if the phrase in brackets matches a customParameter, are we good to go
            if (this.customParameterMap[phraseInBrackets]) {
                return phraseInBrackets;
            }
        }
        return;
    }

    getCompletion(line: string, position: Position, text: string): CompletionItem[] | null {
        const { line: lineNumber, character}  = position;
        //Get line part without gherkin part
        const match = this.getGherkinMatch(line, text);
        if (!match) {
            return null;
        }
        let [, , gherkinPart, , originalStepPart] = match;
        //We don't need last word in our step part due to it could be incompleted
        const stepPart = originalStepPart.replace(/[^\s]+$/, '');

        /*
        return [
            {
                label: this.elements
            },
            {
                label: originalStepPart
            }
        ]
        */

        // Find the step definition that it matches exactly

        // Check if we are inside a stepdefition and on top of a custom parameter
        const highlightedCustomParameter = this.isCustomParameterHighlighted(line, character, text);
        const highlightedCustomParameterConfig = this.customParameterMap[highlightedCustomParameter]
        const customParameterAutocomplete = highlightedCustomParameterConfig && highlightedCustomParameterConfig.autocomplete;

        const res = this.elements
            //Filter via gherkin words comparing if strictGherkinCompletion option provided
            .filter((step) => {
                if (this.settings.cucumberautocomplete.strictGherkinCompletion) {
                    const strictGherkinPart = this.getStrictGherkinType(gherkinPart, lineNumber, text);
                    return step.gherkin === strictGherkinPart;
                } else {
                    return true;
                };
            })
            //Current string without last word should partially match our regexp
            .filter((step) => step.partialReg.test(stepPart))
            //We got all the steps we need so we could make completions from them
            .map(step => {
                return {
                    label: step.text,
                    kind: CompletionItemKind.Snippet,
                    data: step.id,
                    documentation: step.documentation,
                    sortText: 'AAA' + '_' + step.text,
                    insertText: this.getCompletionInsertText(this.settings.cucumberautocomplete.customParametersAutocomplete ? step.originalText : step.text, stepPart),
                    insertTextFormat: InsertTextFormat.Snippet
                };
            });

        // If we have one, we need to return our completion list
        if (!!highlightedCustomParameter && customParameterAutocomplete && !!customParameterAutocomplete.length) {
            const documentation = this.customParameterMap[highlightedCustomParameter].documentation;
            return customParameterAutocomplete.map(
                    (autocomplete:string) => ({
                        label: autocomplete,
                        kind: CompletionItemKind.Text,
                        documentation,
                        //sortText: getSortPrefix(step.count, 5) + '_' + step.text,
                        insertText: autocomplete,
                        insertTextFormat: InsertTextFormat.PlainText
                    })
                );
        }
        return res.length ? res : null;
    }

    getCompletionResolve(item: CompletionItem): CompletionItem {
        this.incrementElementCount(item.data);
        return item;
    }

}
