import security from 'eslint-plugin-security';
export default [{ignores:['node_modules/**','coverage/**','private_uploads/**']},{files:['**/*.js'],languageOptions:{ecmaVersion:'latest',sourceType:'module'},plugins:{security},rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'no-constant-condition':'error','security/detect-unsafe-regex':'warn'}}];
