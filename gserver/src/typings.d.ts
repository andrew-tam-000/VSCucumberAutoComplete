type StepSettings = string[];

type PagesSettings = {
    [page: string]: string
};

type CustomParameter = {
    parameter: string | RegExp,
    value: string,
    // This is the forced display value
    display: string
    // Make this an autosnippet, even if no wildcard
    isAutosnippet: boolean,
    // If specified, show a list of options
    autocomplete: (string|number)[] | null
    documentation: string
};

type FormatConf = {
    [key: string]: number | 'relative'
};

interface Settings {
    cucumberautocomplete: {
        steps?: StepSettings,
        pages?: PagesSettings,
        syncfeatures?: boolean | string,
        strictGherkinCompletion?: boolean,
        strictGherkinValidation?: boolean,
        smartSnippets?: boolean,
        stepsInvariants?: boolean,
        customParameters?: CustomParameter[],
        customParametersAutocomplete?: boolean,
        skipDocStringsFormat?: boolean,
        formatConfOverride?: FormatConf[],
        onTypeFormat?: boolean,
        gherkinDefinitionPart?: string,
        stepRegExSymbol?: string
    }
}
